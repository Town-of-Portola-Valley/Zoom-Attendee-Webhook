'use strict';

const _ = require('lodash');
const { DateTime } = require('luxon');
const path = require('node:path');
const { makeEmptyResponse, makeHTMLResponse, DATETIME_CLEAR, TIME_SIMPLENOZERO } = require('../handlers/helpers');

const CONTENT_ENCODING = 'Content-Encoding';

describe('helpers', () => {
    describe('git_version', () => {
        beforeEach(() => {
            jest.clearAllMocks();
            jest.resetModules();
        });

        it('reads git_version.json file', async () => {
            expect.assertions(1);
            let now;
            jest.mock('node:fs', () => {
                const foo = new Date(); // hack to bring this in scope so it can be
                now = foo;
                return {
                    promises: {
                        stat: jest.fn().mockResolvedValue({ mtime: foo }),
                    },
                };
            });
            jest.mock(path.join(module.path, '..', 'git_version.json'), () => ({
                gitVersion: '2.3.4',
            }), { virtual: true });

            const { git_version } = require('../handlers/helpers');
            await expect(git_version).resolves.toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    mtime: now,
                }),
                expect.objectContaining({
                    gitVersion: '2.3.4',
                })
            ]));
        });

        it('returns array with date and version', async () => {
            expect.assertions(1);
            jest.dontMock('node:fs'); // Not sure why this is needed when beforeEach() should have reset everything
            const { git_version } = require('../handlers/helpers');

            await expect(git_version).resolves.toStrictEqual(expect.arrayContaining([
                expect.objectContaining({
                    mtime: expect.any(Object)
                }),
                expect.objectContaining({
                    gitVersion: '1.0.0',
                })
            ]));
        });
    });

    it('TIME_SIMPLENOZERO', async () => {
        expect.assertions(1);
        const result = DateTime.fromObject({ hour: 9, minute: 37 }, { zone: 'America/Los_Angeles' }).toLocaleString(TIME_SIMPLENOZERO);

        expect(result).toBe('9:37 AM PDT');
    });

    it('DATETIME_CLEAR', async () => {
        expect.assertions(1);
        const result = DateTime.fromObject({ year: 2022, month: 7, day: 5, hour: 9, minute: 37 }, { zone: 'America/Los_Angeles' }).toLocaleString(DATETIME_CLEAR);

        expect(result).toBe('Tue, Jul 5, 9:37 AM PDT');
    });

    it('empty response', async () => {
        expect.assertions(3);
        const result = await makeEmptyResponse(12345);

        expect(result).toHaveProperty('headers');
        expect(result.headers).toHaveProperty('X-Git-Version');
        expect(result).toHaveProperty('statusCode', 12345);
    });

    describe('html response', () => {
        it('security headers', async () => {
            expect.assertions(1);
            const result = await makeHTMLResponse();

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'Strict-Transport-Security': expect.stringMatching(/.+/),
                    'Content-Security-Policy': expect.stringMatching(/.+/),
                    'X-Frame-Options': expect.stringMatching(/.+/),
                    'X-Content-Type-Options': expect.stringMatching(/.+/),
                    'Referrer-Policy': expect.stringMatching(/.+/),
                    'X-XSS-Protection': expect.stringMatching(/.+/),
                }),
            }));
        });

        it('content headers', async () => {
            expect.assertions(1);
            const result = await makeHTMLResponse();

            expect(result).toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'Content-Type': expect.stringMatching(/^text\/html$/),
                    Vary: 'Accept-Encoding',
                }),
            }));
        });

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
