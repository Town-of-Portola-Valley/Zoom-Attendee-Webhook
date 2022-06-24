'use strict';

const _ = require('lodash');
const { makeEmptyResponse, makeHTMLResponse } = require('../handlers/helpers');

const CONTENT_ENCODING = 'Content-Encoding';

describe('helpers', () => {
    it('empty response', async () => {
        expect.assertions(3);
        const result = await makeEmptyResponse(12345);

        expect(result).toHaveProperty('headers');
        expect(result.headers).toHaveProperty('X-Git-Version');
        expect(result).toHaveProperty('statusCode', 12345);
    });

    describe('html response', () => {
        it('no accept-encoding', async () => {
            expect.assertions(6);
            const result = await makeHTMLResponse(12345, 'TEST');

            expect(result).toHaveProperty('headers');
            expect(result.headers).not.toHaveProperty(CONTENT_ENCODING);
            expect(_.keys(result.headers)).toHaveLength(9);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body', 'TEST');
            expect(result).toHaveProperty('isBase64Encoded', false);
        });

        it('br accept-encoding', async () => {
            expect.assertions(7);
            const result = await makeHTMLResponse(12345, 'TEST', 'br');

            expect(result).toHaveProperty('headers');
            expect(result.headers).toHaveProperty(CONTENT_ENCODING, 'br');
            expect(_.keys(result.headers)).toHaveLength(10);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body');
            expect(result.body).not.toBe('TEST');
            expect(result).toHaveProperty('isBase64Encoded', true);
        });

        it('deflate accept-encoding', async () => {
            expect.assertions(7);
            const result = await makeHTMLResponse(12345, 'TEST', 'deflate');

            expect(result).toHaveProperty('headers');
            expect(result.headers).toHaveProperty(CONTENT_ENCODING, 'deflate');
            expect(_.keys(result.headers)).toHaveLength(10);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body');
            expect(result.body).not.toBe('TEST');
            expect(result).toHaveProperty('isBase64Encoded', true);
        });

        it('gzip accept-encoding', async () => {
            expect.assertions(7);
            const result = await makeHTMLResponse(12345, 'TEST', 'gzip');

            expect(result).toHaveProperty('headers');
            expect(result.headers).toHaveProperty(CONTENT_ENCODING, 'gzip');
            expect(_.keys(result.headers)).toHaveLength(10);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body');
            expect(result.body).not.toBe('TEST');
            expect(result).toHaveProperty('isBase64Encoded', true);
        });

        it('rando accept-encoding', async () => {
            expect.assertions(6);
            const result = await makeHTMLResponse(12345, 'TEST', 'rando');

            expect(result).toHaveProperty('headers');
            expect(result.headers).not.toHaveProperty(CONTENT_ENCODING);
            expect(_.keys(result.headers)).toHaveLength(9);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body', 'TEST');
            expect(result).toHaveProperty('isBase64Encoded', false);
        });
    });
});
