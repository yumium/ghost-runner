//UNITS: Time in seconds, Pace in min/km, Distance in meters

class Status{
    constructor(splitPace, quality, totalDistTravelled, totalTimeElapsed) {
        this.splitPace = splitPace
        this.quality = quality
        this.totalDistTravelled = totalDistTravelled
        this.totalTimeElapsed = totalTimeElapsed
    }

    report () {
        return `Pace: ${Math.round(this.splitPace * 100) / 100} min/km \nQuality: ${this.quality} \nDistance: ${Math.round(this.totalDistTravelled * 100) / 100}m \nTime: ${this.totalTimeElapsed}s \n`
    }
}


class PaceCue {
    constructor(tol, slowURL, keepURL, fastURL, user, ghost) {      //it might be a good idea to have tol = 0.5 * range
        this._tol = tol
        this._cueReady = true
        this._resetCueReadyRatio = 0.5

        this._slowAudio = new Audio(slowURL)
        this._keepAudio = new Audio(keepURL)
        this._fastAudio = new Audio(fastURL)

        this._user = user
        user._observers.push(this)
        this._ghost = ghost
    }

    updateCue (userStatus, ghostStatus) {
        const distDiff = userStatus.totalDistTravelled - ghostStatus.totalDistTravelled
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
    
    update () {
        this.updateCue(this._user.getStatus(), this._ghost.getStatus())
    }
}

class DistanceCue {
    constructor(url, range, user, ghost) {
        this._audio = new Audio(url)
        this._audio.loop = true
        this._range = range     // Audible range. Volumn changes proportionally with distDiff within range.
        
        this._user = user
        user._observers.push(this)
        this._ghost = ghost
    }

    play () {
        this._audio.play()
    }

    resetVolumn (userStatus, ghostStatus) {
        const distDiff = Math.abs(userStatus.totalDistTravelled - ghostStatus.totalDistTravelled)
        const range = this._range       
        if (distDiff <= range) {
            this._audio.volume = 1 - distDiff / range
        } else {
            this._audio.volume = 0
        }
    }

    update () {
        this.resetVolumn(this._user.getStatus(), this._ghost.getStatus())
    }
}

class GPS {
    constructor(numPosTracked) {    //numPosTracked >= 2, 5 recommended
        this._creationTime = null     //ASSUMPTION: GPS signal is stabilized
        this._pastPos = new Array(numPosTracked) //ASSUMPTION: pastPos is updated regularly, every 1-2 seconds, without a lot of outliers (outlier catcher isn't implemented)
        this._pastDist = new Array(numPosTracked - 1)  //DTI: pastDist tracks the marginal distance difference of pastPos
        this._totalDist = 0     //DTI: totalDist tracks the total distance covered from creation of GPS object till the last position object registered
        this._observers = []
    }

    /** User starts running, record start time and inital position
     */
    start (lat, lon) {
        this._creationTime = Date.now()
        this._pastPos.push([lat, lon, this._creationTime])
        this._pastPos.shift()
    }

    /** Return a boolean stating if the user has started running */
    hasStarted () {
        return Boolean(this._pastPos[this._pastPos.length-1])
    }

    /** Adds a new GPS position of the user
     * Pre: hasStarted() */
    addPos (lat, lon) {
        this._pastPos.push([lat,lon,Date.now()])
        this._pastPos.shift()
        
        const length = this._pastPos.length
        let extraDist = this._getDistanceFromLatLonInKm(this._pastPos[length-2][0], this._pastPos[length-2][1], this._pastPos[length-1][0], this._pastPos[length-1][1]) * 1000
        this._totalDist += extraDist
        this._pastDist.push(extraDist)
        this._pastDist.shift()

        if (this.isStatusReady()) this._notifyObservers()
    }

    /** Return a boolean stating whether there are enough data points to generate status */
    isStatusReady () {
        return this._pastPos[0] !== undefined
    }

    /** Returns an object that contains the newest status 
     * Pre: isStatusReady() (=> hasStarted()) */
    getStatus () {
        const length = this._pastPos.length

        const timeDiff = (this._pastPos[length-1][2] - this._pastPos[0][2]) / 1000
        const pace = (timeDiff / 60) / ((this._sum(this._pastDist)) / 1000)
        

        let quality;                    //CUSTOMIZABLE, pace quality depends on GPS reading frequency
        switch (true) {
            case timeDiff / (length - 1) < 3:
                quality = "good"
                break;
            case timeDiff / (length - 1) < 5:
                quality = "OK"
                break;
            default:
                quality = "poor"
                break;
        }

        return new Status(pace, quality, this._totalDist, (this._pastPos[length-1][2] - this._creationTime) / 1000)
    }

    /** Helper functions that sums up the values in an array */
    _sum (arr) {
        return arr.reduce((acc,val) => acc+val)
    }

    /** Helper function that implements the Haversine formula */
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

    _notifyObservers () {
        for (let i = 0; i < this._observers.length; i++) {
            this._observers[i].update()
        }
    }
}

// input [[pace1,dist1],[pace2,dist2]...]. Cannot handle empty input
class Ghost {
    constructor(args) {
        this._dna =  this._standardize(args)
        this._startTime = null          // Date obj in ms
        this._totalRunningTime = null  // total time the ghost runs, in s
        this._cachedIndex = 0        // Cache the index of last segment to make access constant
    }
    
    /** A helper function that returns the standardized ghost DNA
     *  The function returs an array of segment objects, which each have these properties
     *  pace: The pace of the segment; 
     *  distance: The distance of the segment; 
     *  startTime: The time when the segment starts; => this allows quick checking of which segment we are in
     *  startDistance: The distance covered already when the segment starts => this precomputation makes multiple accessing fast */ 
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


    /** Function to let the ghost start running
     * Warning: calling start() multiple times will update the starting and ending time to the newest call
     */
    start () {
        this._startTime = Date.now()

        const lastSeg = this._dna[this._dna.length-1]
        this._totalRunningTime = lastSeg.startTime + lastSeg.pace * 60 / 1000 * lastSeg.distance
    }

    /** Returns a boolean stating if the ghost has started running
     */
    hasStarted () {
        return Boolean(this._startTime)
    }

    /** Returns a boolean stating if the ghost has finished the scheduled run
     * Pre: hasStarted()
     */
    hasEnded () {
        return this._getTime() > this._totalRunningTime
    }

    /** Return status of the ghost
     * Pre: hasStarted(), !hasEnded() */
    getStatus () {
        const timeElapsed = this._getTime()

        return new Status(this._dna[this._getSegIndex(timeElapsed)].pace, "good", this._getDistance(timeElapsed), timeElapsed)
    }

    /** Helper that gets the time elapsed in seconds since start time  */
    _getTime () {
        return (Date.now() - this._startTime) / 1000
    }

    /** Helper that gets the distance travelled by ghost so far in meters, extrapolated by pace in segments */
    _getDistance (timeElapsed) {
        const currentSeg = this._dna[this._getSegIndex(timeElapsed)]
        const distInThisSeg = (timeElapsed - currentSeg.startTime) / (currentSeg.pace * 60 / 1000)
        return currentSeg.startDistance + distInThisSeg
    }

    /** Gives the index of the current segment we are in given time elapsed. Will return the last segment still if race has ended */
    _getSegIndex (timeElapsed) {
        let i = this._cachedIndex
        // Invariant a[0..i].startTime < timeElapsed
        while (i+1 < this._dna.length && this._dna[i+1].startTime < timeElapsed) i++
        this._cachedIndex = i
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

function ask() {
    let echo;
    do {
        echo = prompt("Please design ghost DNA, using format: pace1, dist1; pace2, dist2 etc. \nPace is in min:sec, distance is in meters \nFor example: 5:40, 1000; 6:00, 1000")
    } while (!echo)

    return echo
}

function adhocParser(input) {
    const lis = input.trim().split(";")
    console.log(lis)
    const out = []
    for (let i = 0; i < lis.length; i++) {
        seg = lis[i].trim().split(",")
        seg[0] = paceParser(seg[0].trim())
        seg[1] = parseInt(seg[1].trim())
        out.push(seg)
    }
    return out
}

function paceParser(input) {
    const part = input.split(":")
    const res = parseInt(part[0].trim()) + parseInt(part[1].trim()) / 60
    return Math.round(res * 100) / 100
}

function readDNA(dna) {
    str = "Your ghost DNA: \n"
    for (let i = 0; i < dna.length; i++) {
        str += `${i+1}. Pace: ${dna[i][0]} min/km, Distance: ${dna[i][1]}m \n`
    }
    return str
}

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
}



const dna = adhocParser(ask())
const ghost = new Ghost(dna)
const myGPS = new GPS(5)
const distanceCue = new DistanceCue("audio/gravel-sound.mp3", 50, myGPS, ghost)
const paceCue = new PaceCue(25,"audio/slow.mp3","audio/keep.mp3","audio/fast.mp3", myGPS, ghost)
const geo = navigator.geolocation







const consent = new Audio("audio/250-milliseconds-of-silence.mp3")
const button = document.querySelector("button")
button.onclick = () => consent.play()

const dnaLog = document.querySelector("#text0")
dnaLog.textContent = readDNA(dna)

const status = document.querySelector('#text1')
let numSuccess = 0
status.textContent = "Success " + numSuccess

const posLog = document.querySelector('#text2')
posLog.textContent = "Last location: Waiting for location"

const report = document.querySelector('#text3')
report.textContent = "Status not yet ready"




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
        const gStatus = ghost.getStatus()
        report.textContent = status.report() + `Distance difference: ${Math.round((status.totalDistTravelled - gStatus.totalDistTravelled) * 100) / 100}m \n`
    } else {
        console.log("Status not yet ready.")
        report.textContent = "Status not yet ready"
    }
}