const { readFromBufferP, extractImages } = require('swf-extract')
const { join } = require('path-extra')
const {
  ensureDirSync,
  writeJsonSync,
  readJsonSync,
  accessSync,
  writeFile,
} = require('fs-extra')
let fetchLocks
let APPDATA_PATH

const getCacheDirPath = () => {
  const path = join(APPDATA_PATH, 'avatar','cache')
  ensureDirSync(path)
  return path
}

const getVersionMap = () => {
  try {
    return readJsonSync(join(getCacheDirPath(), '..', 'version.json'))
  } catch (e) {
    return {}
  }
}

const setVersionMap = (data) => {
  try {
    writeJsonSync(join(getCacheDirPath(), '..', 'version.json'), data)
  } catch (e) {
    return
  }
}

let versionMap

const getFilePath = (mstId) => [join(getCacheDirPath(), `${mstId}_n.png`), join(getCacheDirPath(), `${mstId}_d.png`)]

const checkExistence = (mstId) => getFilePath(mstId).map(path => {
  try {
    accessSync(path)
    return true
  } catch (e) {
    return false
  }
}).reduce((a, b) => a && b)

const mayExtractWithLock = async ({ serverIp, path, mstId }) => {
  // some other process is already fetching that data
  if (fetchLocks.get(path) || !serverIp)
    return

  fetchLocks.set(path, true)
  const [ normalPath, damagedPath ] = getFilePath(mstId)
  const fetched = await fetch(`http://${serverIp}${path}`)
  if (!fetched.ok)
    throw new Error('fetch failed.')
  const ab = await fetched.arrayBuffer()
  const swfData = await readFromBufferP(new Buffer(ab))
  await Promise.all(
    extractImages(swfData.tags).map(async p => {
      const data = await p
      if (
        'characterId' in data &&
        ['jpeg', 'png', 'gif'].includes(data.imgType)
      ) {
        const {characterId, imgData} = data
        getCacheDirPath()
        switch (characterId) {
        case 21: {
          await writeFile(normalPath, imgData)
          break
        }
        case 23: {
          await writeFile(damagedPath, imgData)
          break
        }
        }
      }
    })
  )
  postMessage([ 'Ready', mstId ])
  // release lock
  fetchLocks.set(path, false)
}

const mkRequestShipGraph = (mstId, version = [], fileName, serverIp, forced = false) => {
  if (!forced && versionMap[mstId] && version.toString() === versionMap[mstId].toString() && checkExistence(mstId)) {
    postMessage([ 'Ready', mstId ])
    return
  }

  versionMap[mstId] = version
  setVersionMap(versionMap)

  const path = `/kcs/resources/swf/ships/${fileName}.swf?VERSION=${versionMap[mstId][0]}`
  mayExtractWithLock({ mstId, path, serverIp })
}

// eslint-disable-next-line no-undef
onmessage = e => {
  const data = [...e.data]
  const type = data.shift()
  switch (type) {
  case 'Initialize': {
    APPDATA_PATH = data.shift()
    versionMap = getVersionMap()
    fetchLocks = new Map()
    break
  }
  case 'Request': {
    mkRequestShipGraph(...data)
  }
  }
}
