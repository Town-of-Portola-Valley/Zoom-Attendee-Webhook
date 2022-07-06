'use strict';

module.exports =
{
    'extends': '@hughescr/eslint-config-default',
    rules:
    {
        'node/no-unpublished-require': ['error', {
            allowModules: ['aws-sdk']
        }],
    },
};
