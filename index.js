'use strict';

const fs = require('fs');
const promisify = require('util').promisify;
const stat = promisify(fs.stat);
const zlib = require('zlib');
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);

/* istanbul ignore next */
const git_version = stat('./git_version.json')
    .then(res => {
        // If we did manage to stat the file, then load it
        return [res, require('./git_version.json')]; // eslint-disable-line node/no-missing-require -- If stat finds the file, it'll be there
    })
    .catch(() => {
        // If we didn't stat the file then hardcode some stuff
        return [{ mtime: new Date() }, { gitVersion: '1.0.0' }];
    });

const AUTHORIZATION_CHECK = process.env.ZOOM_AUTHORIZATION_CODE;

const ACCEPT_ENCODING = 'accept-encoding';

const makeHTMLResponse = async (statusCode, body, acceptEncoding) => {
    let maybeZipped = {};
    let base64Encoded = false;
    let convertedBody = body;

    if(/\bbr\b/.test(acceptEncoding)) {
        convertedBody = (await brotli(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'br' };
        base64Encoded = true;
    } else if(/\bgzip\b/.test(acceptEncoding)) {
        convertedBody = (await gzip(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'gzip' };
        base64Encoded = true;
    } else if(/\deflate\b/.test(acceptEncoding)) {
        convertedBody = (await deflate(body)).toString('base64');
        maybeZipped = { 'Content-Encoding': 'deflate' };
        base64Encoded = true;
    }

    return {
        statusCode: statusCode,
        headers: {
            ...maybeZipped,
            'X-Git-Version': JSON.stringify(await git_version),
            'Content-Type': 'text/html',
            Vary: 'Accept-Encoding',
        },
        isBase64Encoded: base64Encoded,
        body: convertedBody,
    };
};

const makeEmptyResponse = async (statusCode) => {
    return {
        statusCode: statusCode,
        headers: {
            'X-Git-Version': JSON.stringify(await git_version),
        },
    };
};

module.exports.handleZoomWebhook = async (event) => {
    const headers = {
        'X-Git-Version': JSON.stringify(await git_version),
    };

    if(!event) {
        console.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred', '');
    }

    if(!event.headers) {
        console.error('No headers were in the event\n' + JSON.stringify(event, null, 2));

        return makeHTMLResponse(500, 'Internal server error occurred', '');
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    if(event.headers.authorization !== AUTHORIZATION_CHECK) {
        console.error('Failed to authenticate request\n' + JSON.stringify(event, null, 2));

        return makeHTMLResponse(401, 'Authorization header failed to match requirements', acceptEncoding);
    }

    if(!event.body) {
        console.error('There was no body/payload in the event\n' + JSON.stringify(event, null, 2));

        return makeHTMLResponse(400, 'No content was sent in the request body', acceptEncoding);
    }

    const body = JSON.parse(event.body);

    if(!body || !body.payload || !body.event) {
        console.error('The body exists, and is valid JSON, but appears to have invalid content\n' + event.body);

        return makeHTMLResponse(422, 'The body must contain a payload and an event', acceptEncoding);
    }

    // At this point the body looks good; has an event and a payload

    switch(body.event) {
        case 'webinar.participant_joined':
            console.info('JOINED\n' + JSON.stringify({
                webinar: {
                    id: body.payload.object.id,
                    title: body.payload.object.topic,
                    start_time: body.payload.object.start_time,
                },
                participant: {
                    id: body.payload.object.participant.id,
                    user_id: body.payload.object.participant.user_id,
                    name: body.payload.object.participant.user_name,
                    join_time: body.payload.object.participant.join_time,
                }
            }));
            break;

        case 'webinar.participant_left':
            console.info('LEFT\n' + JSON.stringify({
                webinar: {
                    id: body.payload.object.id,
                    title: body.payload.object.topic,
                    start_time: body.payload.object.start_time,
                },
                participant: {
                    id: body.payload.object.participant.id,
                    user_id: body.payload.object.participant.user_id,
                    name: body.payload.object.participant.user_name,
                    leave_time: body.payload.object.participant.join_time,
                }
            }));
            break;

        default:
            console.error('Unexpected event type\n' + JSON.stringify(body, null, 2));

            return makeHTMLResponse(422, `Unexpected event type: ${body.event}`, acceptEncoding);
    }

    return {
        ...headers,
        statusCode: 204,
    };
};

module.exports.handleListMeetings = async (event) => {
    if(!event) {
        console.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred');
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    console.info('LIST_MEETINGS\n', JSON.stringify(event, null, 2));

    return makeHTMLResponse(200, '<html><head><title>Active Portola Valley Webinars</title></head><body><h1>Active Portola Valley Webinars</h1><ul><li><a href="meeting/123456789">Some meeting (ID: 123456789)</a></li></ul></body>', acceptEncoding);
};

module.exports.handleListParticipants = async (event) => {
    if(!event) {
        console.error('No event was received');

        return makeHTMLResponse(500, 'Internal server error occurred');
    }

    const acceptEncoding = event.headers[ACCEPT_ENCODING];

    console.info('LIST_PARTICIPANTS\n', JSON.stringify(event, null, 2));

    return makeHTMLResponse(200, `<html><head><title>Participants in Meeting ${event.pathParameters.meeting_id}</title></head><body><h1>Participants in Meeting ${event.pathParameters.meeting_id}</h1><ul><li>John Smith</li><li>Jane Doe</li></ul></body>`, acceptEncoding);
};
