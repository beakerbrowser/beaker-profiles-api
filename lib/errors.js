class ExtendableError extends Error {
  constructor (msg) {
    super(msg)
    this.name = this.constructor.name
    this.message = msg
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(msg)).stack
    }
  }
}

exports.MissingParameterError = class MissingParameterError extends ExtendableError {
  constructor (msg) {
    super(msg || 'Missing a required parameter')
    this.missingParameter = true
  }
}
