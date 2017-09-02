const slugifyUrl = require('slugify-url')
const normalizeUrl = require('normalize-url')

const NORMALIZE_OPTS = {
  stripFragment: false,
  stripWWW: false,
  removeQueryParameters: false
}

exports.string = function (v, opts) {
  if (typeof v === 'number') v = v.toString()
  if (typeof v === 'string') return v
  if (opts && opts.required) throw new Error('Missing field (string)')
  return null
}

exports.object = function (v, opts) {
  if (v && typeof v === 'object') return v
  if (opts && opts.required) throw new Error('Missing field (object)')
  return null
}

exports.path = function (v) {
  v = exports.string(v)
  if (v && !v.startsWith('/')) v = '/' + v
  return v
}

exports.arrayOfFollows = function (arr) {
  arr = Array.isArray(arr) ? arr : [arr]
  return arr.map(v => {
    if (!v) return false
    if (typeof v === 'string') {
      return {url: exports.datUrl(v)}
    }
    if (v.url && typeof v.url === 'string') {
      return {url: exports.datUrl(v.url), name: exports.string(v.name)}
    }
  }).filter(Boolean)
}

exports.url = function (v, opts) {
  v = exports.string(v, opts)
  return normalizeUrl(v, NORMALIZE_OPTS)
}

exports.datUrl = function (v) {
  if (v && typeof v === 'string') {
    if (v.startsWith('http')) {
      return null
    }
    if (!v.startsWith('dat://')) {
      v = 'dat://' + v
    }
    return v
  }
  return null
}

exports.voteSubject = function (v) {
  v = exports.string(v)
  if (!v) {
    throw new Error('Subject required on votes')
  }

  v = v.slice('dat://'.length).replace(/\//g, ':')
  return v
}

exports.number = function (v, opts) {
  v = +v
  if (opts && opts.required) {
    if (typeof v !== 'number') {
      throw new Error('Invalid field, must be a number')
    }
  }
  return v
}

exports.vote = function (v) {
  v = exports.number(v)
  if (v > 0) return 1
  if (v < 0) return -1
  return 0
}

exports.archiveUrl = function (v) {
  if (v) {
    if (typeof v === 'string') {
      return v
    }
    if (typeof v.url === 'string') {
      return v.url
    }
  }
  throw new Error('Not a valid archive')
}

exports.recordUrl = function (v) {
  if (typeof v === 'string') {
    return v
  }
  if (typeof v._url === 'string') {
    return v._url
  }
  throw new Error('Not a valid record')
}

exports.urlSlug = function (v) {
  v = exports.string(v, {required: true})
  return slugifyUrl(v, {skipProtocol: false})
}
