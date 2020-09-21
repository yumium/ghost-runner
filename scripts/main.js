class PaceCue {
    constructor(tol, slowURL, keepURL, fastURL) {      //it might be a good idea to have tol = 0.5 * range
        this._tol = tol
        this._cueReady = true
        this._resetCueReadyRatio = 0.5

        this._slowAudio = new Audio(slowURL)
        this._keepAudio = new Audio(keepURL)
        this._fastAudio = new Audio(fastURL)
    }

    updateCue (userStatus, ghostStatus) {
        const distDiff = userStatus.totalDistanceTravelled - ghostStatus.totalDistanceTravelled
        if (Math.abs(distDiff) < this._tol*this._resetCueReadyRatio && !this._cueReady) {           //DTI: distDiff < tol => this._cueReady is true
            this._keepAudio.play()
            this._cueReady = true
            console.log("Keep audio playing")
        } else if (distDiff > this._tol && this._cueReady) {
            this._fastAudio.play()
            this._cueReady = false
            console.log("Fast audio playing")
        } else if (distDiff < -1*this._tol && this._cueReady) {
            this._slowAudio.play()
            this._cueReady = false
            console.log("Slow audio playing")
        }
    }
    
    update (userStatus, ghostStatus) {
        this.updateCue(userStatus, ghostStatus)
    }
}

class DistanceCue {
    constructor(url, range) {
        this._audio = new Audio(url)
        this._audio.loop = true
        this._range = range     // Audible range. Volumn changes proportionally with distDiff within range.
    }

    play () {
        this._audio.play()
    }

    resetVolumn (userStatus, ghostStatus) {
        const distDiff = Math.abs(userStatus.totalDistanceTravelled - ghostStatus.totalDistanceTravelled)
        const range = this._range       
        if (distDiff <= range) {
            this._audio.volume = 1 - distDiff / range
        } else {
            this._audio.volume = 0
        }
    }

    update (userStatus, ghostStatus) {
        this.resetVolumn(userStatus, ghostStatus)
    }
}

class GPS {
    constructor(numPosTracked) {
        this._creationTime = null     //ASSUMPTION: GPS signal is stabilized
        this._pastPos = new Array(numPosTracked) //ASSUMPTION: pastPos is updated regularly, every 1-2 seconds, without a lot of outliers (outlier catcher isn't implemented)
        this._pastDist = new Array(numPosTracked - 1)  //DTI: pastDist tracks the marginal distance difference of pastPos, in meters
        this._totalDist = 0     //DTI: totalDist tracks the total distance covered from creation of GPS object till the last position object registered, in meters
    }

    start (lat, lon) {
        this._creationTime = Date.now()
        this._pastPos.push([lat, lon, this._creationTime])
        this._pastPos.shift()
    }

    hasStarted () {
        const length = this._pastPos.length
        if (this._pastPos[length-1]) {
            return true
        } else {
            return false
        }
    }

    /* Adds a new GPS position */
    //Pre: hasStarted()
    addPos (lat, lon) {
        this._pastPos.push([lat,lon,Date.now()])
        this._pastPos.shift()
        
        const length = this._pastPos.length
        let extraDist = this._getDistanceFromLatLonInKm(this._pastPos[length-2][0], this._pastPos[length-2][1], this._pastPos[length-1][0], this._pastPos[length-1][1]) * 1000
        this._totalDist += extraDist
        this._pastDist.push(extraDist)
        this._pastDist.shift()
    }

    isStatusReady () {
        return this._pastPos[0] !== undefined
    }

    /* Returns an object that contains the newest status */
    // Pre: isStatusReady (which implies hasStarted())
    getStatus () {
        const length = this._pastPos.length

        const timeDiff = (this._pastPos[length-1][2] - this._pastPos[0][2]) / 1000         // in seconds
        const pace = (timeDiff / 60) / ((this._sum(this._pastDist)) / 1000)
        

        let quality;                    //CUSTOMIZABLE, pace quality depends on GPS reading frequency
        switch (true) {
            case timeDiff < (3 * (length - 1)):
                quality = "good"
                break;
            case timeDiff < (5 * (length - 1)):
                quality = "OK"
                break;
            case timeDiff >= (5 * (length - 1)):
                quality = "poor"
                break;
        }

        console.log(quality)
        return {
            splitPace: pace,                                                        //in min/km
            paceQuality: quality,
            totalDistanceTravelled: this._totalDist,
            totalTimeElapsed: (this._pastPos[length-1][2] - this._creationTime) / 1000     //in seconds
        }
    }

    /* Helper functions that sums up the values in an array */
    _sum (arr) {
        return arr.reduce((acc,val) => acc+val)
    }

    _getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
        var R = 6371; // Radius of the earth in km
        var dLat = this._deg2rad(lat2-lat1);
        var dLon = this._deg2rad(lon2-lon1); 
        var a = 
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(this._deg2rad(lat1)) * Math.cos(this._deg2rad(lat2)) * 
          Math.sin(dLon/2) * Math.sin(dLon/2)
          ; 
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        var d = R * c; // Distance in km
        return d;
    }

    _deg2rad(deg) {
        return deg * (Math.PI/180)
    }
}

class Ghost {
    // input [pace in min/km, for dist in m], or pace in min/km which defaults to 1000m of distance. Put as many inputs as you want. They will be interpreted in chronological order.
    constructor(...args) {
        this._dna =  this._standardize(args)
        this._startTime = null          // Date obj in ms
        this._totalRunningTime = null  // total time the ghost runs, in s
    }
    
    /** A helper function that returns the standardized ghost DNA
     *  The function returs an array of segment objects, which each have 3 properties
     *  pace: The pace of the segment; 
     *  distance: The distance of the segment; 
     *  startTime: The time in seconds when the segment starts;
     *  startDistance: The distance covered already when the segment starts */ 
    _standardize (args) {
        const output = []
        const firstSeg = {
            pace: typeof(args[0]) === "number" ? args[0] : args[0][0],
            distance: typeof(args[0]) === "number" ? 1000 : args[0][1],
            startTime: 0,
            startDistance: 0
        }
        output.push(firstSeg)

        for (let i = 1; i < args.length; i++) {
            const nextSeg = {
                pace: typeof(args[i]) === "number" ? args[i] : args[i][0],
                distance: typeof(args[i]) === "number" ? 1000 : args[i][1],
                startTime: output[i-1].startTime + output[i-1].pace * 60 / 1000 * output[i-1].distance,
                startDistance: output[i-1].startDistance + output[i-1].distance
            }
            output.push(nextSeg)
        }

        return output
    }


    // warning: starting multiple times will reset the start time and finish time each time
    start () {
        this._startTime = Date.now()

        const lastSeg = this._dna[this._dna.length-1]
        this._totalRunningTime = lastSeg.startTime + lastSeg.pace * 60 / 1000 * lastSeg.distance
    }

    hasStarted () {
        if (this._startTime) {
            return true
        } else {
            return false
        }
    }

    //Pre: hasStarted
    hasEnded () {
        return this._getTime() > this._totalRunningTime
    }

    //Pre: hasStarted, !hasEnded
    getStatus () {
        const timeElapsed = this._getTime()

        return {
            splitPace: this._dna[this._getSegIndex(timeElapsed)].pace,   // There is not smoothing provided here, which is fine for now as we don't use the pace at all
            totalDistanceTravelled: this._getDistance(timeElapsed),
            totalTimeElapsed: timeElapsed
        }
    }

    /* Helper that gets the time elapsed in seconds since start time */
    _getTime () {
        return (Date.now() - this._startTime) / 1000
    }

    /* Helper that gets the distance travelled by ghost so far in meters, extrapolated by pace in segments */
    _getDistance (timeElapsed) {
        const currentSeg = this._dna[this._getSegIndex(timeElapsed)]
        const distInThisSeg = (timeElapsed - currentSeg.startTime) / (currentSeg.pace * 60 / 1000)
        return currentSeg.startDistance + distInThisSeg
    }

    /* Gives the index of the current segment we are in given time elapsed. Will return the last segment still if race has ended */
    _getSegIndex (timeElapsed) {
        let i = 0
        // Invariant a[0..i].startTime < timeElapsed
        while (i+1 < this._dna.length && this._dna[i+1].startTime < timeElapsed) i++
        return i
    }
}


  


// acc = acc0 ... 1, so acc0 # of times
function forEvery(ms, acc, func) {
    if (acc > 0) {
        func()
        setTimeout(() => forEvery(ms, acc-1, func), ms)
    }
}


const consent = new Audio("audio/250-milliseconds-of-silence.mp3")
const button = document.querySelector("button")
button.onclick = () => consent.play()


const ghost = new Ghost([3,50],[10,50],[3,50],[10,50],[3,300],[10,300])

const distanceCue = new DistanceCue("audio/gravel-sound.mp3", 50)
const paceCue = new PaceCue(25,"audio/slow.mp3","audio/keep.mp3","audio/fast.mp3")
const myGPS = new GPS(5)




const geo = navigator.geolocation
const status = document.querySelector('#text1')
let numSuccess = 0
status.textContent = "Success " + numSuccess

const posLog = document.querySelector('#text2')
posLog.textContent = "Last location: Waiting for location"

const report = document.querySelector('#text3')
report.textContent = "Status not yet ready"

function success(pos) {
    numSuccess += 1
    status.textContent = "Success " + numSuccess

    const crd = pos.coords

    posLog.textContent = "Last location: " + crd.latitude + " " + crd.longitude

    if (myGPS.hasStarted()) {
        myGPS.addPos(crd.latitude, crd.longitude)
    } else {
        myGPS.start(crd.latitude, crd.longitude)
    }
}

function error(err) {
    status.textContent = 'ERROR(' + err.code + '): ' + err.message
}

let options = {
    enableHighAccuracy: true,
    maximumAge: 0
};



setTimeout(() => {
    distanceCue.play()
    ghost.start()
    geo.getCurrentPosition(success, error, options)
    forEvery(2000, 300, myFunc)     // 10 minutes
}, 5000)



const myFunc = () => {
    geo.getCurrentPosition(success, error, options)

    if (myGPS.isStatusReady()) {
        const status = myGPS.getStatus()
        report.textContent = `Pace: ${status.splitPace}, Quality: ${status.paceQuality}, Distance: ${status.totalDistanceTravelled}, Time: ${status.totalTimeElapsed}, Distance difference: ${status.totalDistanceTravelled - ghost.getStatus().totalDistanceTravelled}`
        distanceCue.update(status, ghost.getStatus())
        paceCue.update(status, ghost.getStatus())
    } else {
        console.log("Status not yet ready.")
        report.textContent = "Status not yet ready"
    }
}