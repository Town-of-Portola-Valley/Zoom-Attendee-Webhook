'use strict';

module.exports =
{
    'extends': '@hughescr/eslint-config-default',
    rules:
    {
        'no-console': 'off',
        'node/no-unpublished-require': ['error', {
            allowModules: ['aws-sdk']
        }],
    },
};
