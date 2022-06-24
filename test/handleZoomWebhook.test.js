'use strict';

process.env.ZOOM_AUTHORIZATION_CODE = 'BOGUS_TOKEN';

const { dynamoDB, makeHTMLResponse, INTERNAL_SERVER_ERROR, AUTHORIZATION_CHECK } = require('../handlers/helpers');
const foo = require('../index');

describe('webhook', () => {
    describe('basic data checks', () => {
        it('should detect missing events', async () => {
            expect.assertions(1);

            const result = foo.handleZoomWebhook();
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should respond correctly to keep-alive pings', async () => {
            expect.assertions(3);

            const event = require('./fixtures/keep-alive.json');
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBeGreaterThanOrEqual(200);
            expect((await result).statusCode).toBeLessThan(300);
        });

        it('should respond correctly when passed no headers', async () => {
            expect.assertions(1);

            const event = {};
            const result = foo.handleZoomWebhook(event);
            const expected = await makeHTMLResponse(500, INTERNAL_SERVER_ERROR);

            await expect(result).resolves.toStrictEqual(expected);
        });

        it('should fail if bad auth code', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: 'BAD_CODE' } };
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBe(401);
        });

        it('should fail if good auth code but no body', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK } };
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBe(400);
        });

        it('should fail if good auth code but body is bad JSON', async () => {
            expect.assertions(1);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{' };
            const result = foo.handleZoomWebhook(event);

            await expect(result).rejects.toThrow('Unexpected end of JSON input');
        });

        it('should fail if body has no event', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{ "payload": 123 }' };
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBe(422);
        });

        it('should fail if body has no payload', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: '{ "event": 123 }' };
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBe(422);
        });

        it('should fail if event is wrong', async () => {
            expect.assertions(2);

            const event = { headers: { authorization: AUTHORIZATION_CHECK }, body: JSON.stringify({
                event: 'webinar.random_event',
                payload: {},
            }) };
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: expect.any(Number),
            }));
            expect((await result).statusCode).toBe(422);
        });
    });

    describe('join', () => {
        it('should succeed when first person joins', async () => {
            expect.assertions(5);

            jest.spyOn(dynamoDB, 'executeStatement')
                .mockReturnValueOnce({ promise: async () => Promise.reject('Does not exist') })
                .mockReturnValueOnce({ promise: async () => Promise.resolve('Insert succeeds though') });

            const event = require('./fixtures/participant-joined.json');
            event.body = JSON.parse(event.body);
            event.body.event_ts = Date.now();
            event.body = JSON.stringify(event.body);
            const result = foo.handleZoomWebhook(event);

            await expect(result).resolves.toStrictEqual(expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Git-Version': expect.stringContaining('gitVersion'),
                }),
                statusCode: 204,
            }));
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.stringContaining('SET ParticipationCount=ParticipationCount + 1'),
            }));
            // We should have attempted to increment ParticipantCount
            expect(dynamoDB.executeStatement).toHaveBeenNthCalledWith(1, expect.objectContaining({
                Statement: expect.not.stringContaining('SET ParticipationCount=ParticipationCount - 1'),
            }));
            // We should be inserting with ParticipantCount = 1
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.arrayContaining([{ N: '1' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
            // We should NOT be inserting with ParticipantCount = 0
            expect(dynamoDB.executeStatement).toHaveBeenLastCalledWith(expect.objectContaining({
                Parameters: expect.not.arrayContaining([{ N: '0' }]),
                Statement: expect.stringContaining('INSERT'),
            }));
        });
    });

    describe('leave', () => {
        it.todo('nothing yet');
    });
});
