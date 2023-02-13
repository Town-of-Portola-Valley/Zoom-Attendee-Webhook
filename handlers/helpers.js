'use strict';

const { promisify } = require('node:util');
const { stat } = require('node:fs').promises;
const path = require('node:path');

const zlib = require('node:zlib');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

const AUTHORIZATION_CHECK = process.env.ZOOM_AUTHORIZATION_CODE;
const ORGANIZATION_NAME   = process.env.ORGANIZATION_NAME;
const DB_TABLE            = process.env.DB_TABLE;
const TIMEZONE            = process.env.TIMEZONE;

// Stryker disable StringLiteral,ObjectLiteral: Ignore these top-level constants for mutation testing
const NO_EVENT_RECEIVED = 'No event was received';
const INTERNAL_SERVER_ERROR = 'Internal server error occurred';

const ACCEPT_ENCODING = 'accept-encoding';
const KEEP_ALIVE = 'keep-alive';

const DATETIME_CLEAR = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
};

const TIME_SIMPLENOZERO = {
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
};

const TIME_SIMPLENOZERO_NOTZ = {
    hour: 'numeric',
    minute: 'numeric',
};
// Stryker enable StringLiteral,ObjectLiteral

// Export the constants
module.exports = {
    ACCEPT_ENCODING,
    AUTHORIZATION_CHECK,
    DATETIME_CLEAR,
    TIME_SIMPLENOZERO,
    TIME_SIMPLENOZERO_NOTZ,
    DB_TABLE,
    INTERNAL_SERVER_ERROR,
    KEEP_ALIVE,
    NO_EVENT_RECEIVED,
    ORGANIZATION_NAME,
    TIMEZONE,
};

const DynamoDB = require('aws-sdk/clients/dynamodb');
// Create and export the dynamoDB service object
const dynamoDB = new DynamoDB();
module.exports.dynamoDB = dynamoDB;

// Stryker disable next-line StringLiteral: git_version.json won't exist till deployment
const git_version = stat(path.join(module.path, '..', 'git_version.json'))
    .then(res => {
        // If we did manage to stat the file, then load it
        // Stryker disable next-line ArrayDeclaration,StringLiteral: git_version.json won't exist till deployment
        return [res, require(path.join(module.path, '..', 'git_version.json'))];
    })
    .catch(() => {
        // If we didn't stat the file then hardcode some stuff
        return [{ mtime: new Date() }, { gitVersion: '1.0.0' }];
    });
module.exports.git_version = git_version;

module.exports.makeHTMLResponse = async (statusCode, body, acceptEncoding) => {
    let maybeZipped = {};
    let base64Encoded = false;
    let convertedBody = body;

    if(/\bbr\b/.test(acceptEncoding)) {
        // Stryker disable ObjectLiteral: Do not worry about brotli params
        convertedBody = (await brotli(body, {
            chunkSize: 1024 * 1024,
            params: {
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
            },
        })).toString('base64');
        // Stryker enable ObjectLiteral
        maybeZipped = { 'Content-Encoding': 'br' };
        base64Encoded = true;
    } else if(/\bgzip\b/.test(acceptEncoding)) {
        convertedBody = (await gzip(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'gzip' };
        base64Encoded = true;
    } else if(/\bdeflate\b/.test(acceptEncoding)) {
        convertedBody = (await deflate(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'deflate' };
        base64Encoded = true;
    }

    return {
        statusCode: statusCode,
        headers: {
            ...maybeZipped,
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'Content-Security-Policy': "default-src 'self' https:; script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'; style-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'",
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin',
            'X-XSS-Protection': '1; mode=block',
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
            Vary: 'Accept-Encoding',
        },
        isBase64Encoded: base64Encoded,
        body: convertedBody,
    };
};

module.exports.makeXMLResponse = async (statusCode, body, acceptEncoding) => {
    const result = await module.exports.makeHTMLResponse(statusCode, body, acceptEncoding);
    result.headers['Content-Type'] = 'application/xml';
    return result;
};

module.exports.makeEmptyResponse = async (statusCode) => {
    return {
        statusCode: statusCode,
        headers: {
            'X-Git-Version': JSON.stringify(await git_version),
        },
    };
};

