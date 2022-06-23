'use strict';

const _ = require('lodash');
const { dynamoDB, makeEmptyResponse, makeHTMLResponse, INTERNAL_SERVER_ERROR } = require('../handlers/helpers');
const foo = require('../index');

// jest.mock('../handlers/helpers.js');

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
            expect(result.headers).not.toHaveProperty('Content-Encoding');
            expect(_.keys(result.headers)).toHaveLength(9);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body', 'TEST');
            expect(result).toHaveProperty('isBase64Encoded', false);
        });

        it('br accept-encoding', async () => {
            expect.assertions(7);
            const result = await makeHTMLResponse(12345, 'TEST', 'br');

            expect(result).toHaveProperty('headers');
            expect(result.headers).toHaveProperty('Content-Encoding', 'br');
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
            expect(result.headers).toHaveProperty('Content-Encoding', 'deflate');
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
            expect(result.headers).toHaveProperty('Content-Encoding', 'gzip');
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
            expect(result.headers).not.toHaveProperty('Content-Encoding');
            expect(_.keys(result.headers)).toHaveLength(9);
            expect(result).toHaveProperty('statusCode', 12345);
            expect(result).toHaveProperty('body', 'TEST');
            expect(result).toHaveProperty('isBase64Encoded', false);
        });
    });
});

describe('webhook', () => {
    describe('basic tests', () => {
        it('should detect missing events', async () => {
            expect.assertions(1);

            const result = foo.handleZoomWebhook();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toEqual(expected);
        });

        it('should respond correctly to keep-alive pings', async () => {
            expect.assertions(1);

            const event = require('./fixtures/keep-alive.json');
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
        });
    });
});
