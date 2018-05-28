/*jshint esversion: 6 */ 
const https = require('https');
const url = require('url');

/**
 * The main handler function that the Alexa skill calls.
 * @param {object} request - An Alexa request object.
 * @param {object} context - An Alexa context object.
*/
exports.handler = function(request, context) {
    if (request.directive.header.namespace === 'Alexa.Discovery' && request.directive.header.name === 'Discover') {
        console.log('Received an Alexa.Discovery request:', sanitizeJson(request));
        handleDiscovery(request, context);
    } else if (request.directive.header.namespace === 'Alexa.PowerController') {
        if (request.directive.header.name === 'TurnOn' || request.directive.header.name === 'TurnOff') {
            console.log('Received an Alexa.PowerController request:', sanitizeJson(request));
            handlePowerControl(request, context);
        }
    } else if (request.directive.header.namespace === 'Alexa' && request.directive.header.name === 'ReportState') {
        console.log('Received a ReportState request:', sanitizeJson(request));
        handleReportState(request, context);
    }

    /**
     * Handles Alexa.Discovery requests (e.g. when Alexa discovers the smart home devices it has).
     * @param {object} request - An Alexa request object.
     * @param {object} context - An Alexa context object.
     */
    function handleDiscovery(request, context) {
        const accessToken = request.directive.payload.scope.token;
        getStructures(accessToken).then((structures) => {
            let endpoints = [];
            for (const structure of Object.values(structures)) {
                endpoints.push({
                    'endpointId': structure.structure_id,
                    'manufacturerName': 'Nest Labs',
                    'friendlyName': `Nest ${structure.name}`,
                    'description': `Nest ${structure.name}`,
                    'displayCategories': ['SWITCH'],
                    'cookie': {},
                    'capabilities': [
                        {
                            'type': 'AlexaInterface',
                            'interface': 'Alexa',
                            'version': '3'
                        },
                        {
                            'interface': 'Alexa.PowerController',
                            'version': '3',
                            'type': 'AlexaInterface',
                            'properties': {
                                'supported': [{
                                    'name': 'powerState'
                                }],
                                'retrievable': true,
                                'proactivelyReported': false
                            }
                        }
                    ]
                });
            }
            // Create a copy to not overwrite the properties we are modifying
            const responseHeader = JSON.parse(JSON.stringify(request.directive.header));
            responseHeader.name = 'Discover.Response';
            const response = {
                event: {
                    header: responseHeader,
                    payload: {
                        'endpoints': endpoints
                    }
                }
            };
            console.log('Responded to an Alexa.Discovery event with:', sanitizeJson(response));
            context.succeed(response);
        }).catch((e) => {
            console.log(`Failed while processing an Alexa.Discovery event with: ${getLoggableError(e)}`);
            context.fail(generateErrorResponse(request, e));
        });
    }

    /**
     * Handles Alexa.PowerController requests (e.g. when the user turns the device on or off).
     * @param {object} request - An Alexa request object
     * @param {object} context - An Alexa context object
     */
    function handlePowerControl(request, context) {
        const newAwayState = request.directive.header.name === 'TurnOn' ? 'home' : 'away';
        const structure = request.directive.endpoint.endpointId;
        const accessToken = request.directive.endpoint.scope.token;
        setAway(newAwayState, structure, accessToken).then((awayStatus) => {
            const powerState = awayStatus === 'home' ? 'ON' : 'OFF';
            const response = generateResponse(request, powerState, 'Response', 'Alexa');
            console.log('Responded to an Alexa.PowerController event with:', sanitizeJson(response));
            context.succeed(response);
        }).catch((e) => {
            console.log(`Failed while processing an Alexa.PowerController event with: ${getLoggableError(e)}`);
            context.fail(generateErrorResponse(request, e));
        });
    }

    /**
     * Handles ReportState requests (e.g. when the user checks the status of the device in the Alexa app).
     * @param {object} request - An Alexa request object.
     * @param {object} context - An Alexa context object.
     */
    function handleReportState(request, context) {
        const structure = request.directive.endpoint.endpointId;
        const accessToken = request.directive.endpoint.scope.token;
        getAway(structure, accessToken).then((awayStatus) => {
            const powerState = awayStatus === 'home' ? 'ON' : 'OFF';
            const response = generateResponse(request, powerState, 'StateReport');
            console.log('Responded to a ReportState event with:', sanitizeJson(response));
            context.succeed(response);
        }).catch((e) => {
            console.log(`Failed while processing a ReportState event with: ${getLoggableError(e)}`);
            context.fail(generateErrorResponse(request, e));
        });
    }

    /**
     * Returns an Alexa response object.
     * @param {object} request - An Alexa request object.
     * @param {string} powerState - The power state (ON/OFF) of the device.
     * @param {string} [name] - The name of the response (header.name).
     * @param {string} [namespace] - The namespace of the response (header.namespace).
     */
    function generateResponse(request, powerState, name, namespace) {
        // Create a copy to not overwrite the properties we are modifying
        const responseHeader = JSON.parse(JSON.stringify(request.directive.header));
        if (name) {
            responseHeader.name = name;
        }
        if (namespace) {
            responseHeader.namespace = namespace;
        }

        responseHeader.messageId = responseHeader.messageId + '-R';
        return {
            context: {
                'properties': [{
                    'namespace': 'Alexa.PowerController',
                    'name': 'powerState',
                    'value': powerState,
                    'timeOfSample': new Date().toISOString(),
                    'uncertaintyInMilliseconds': 300
                }]
            },
            event: {
                header: responseHeader,
                endpoint: {
                    scope: {
                        type: 'BearerToken',
                        token: request.directive.endpoint.scope.token
                    },
                    endpointId: request.directive.endpoint.endpointId
                },
                payload: {}
            }
        };
    }

    /**
     * Returns an Alexa error response object.
     * @param {object} request - An Alexa response object.
     * @param {object} errorObj - An error object with the keys statusCode (optional) and message.
     */
    function generateErrorResponse(request, errorObj) {
        // Create a copy to not overwrite the properties we are modifying
        const responseHeader = JSON.parse(JSON.stringify(request.directive.header));
        responseHeader.namespace = 'Alexa';
        responseHeader.name = 'ErrorResponse';
        responseHeader.messageId = responseHeader.messageId + '-R';
        // Based on the HTTP status code (if provided), determine the Alexa error type
        let errorType;
        switch (errorObj.statusCode) {
            case (401):
                errorType = 'INVALID_AUTHORIZATION_CREDENTIAL';
                break;
            case (404):
                errorType = 'NO_SUCH_ENDPOINT';
                break;
            case (429):
                errorType = 'RATE_LIMIT_EXCEEDED';
                break;
            default:
                errorType = 'INTERNAL_ERROR';
        }

        return {
            event: {
                header: responseHeader,
                endpoint: {
                    endpointId: request.directive.endpoint.endpointId
                },
                payload: {
                    type: errorType,
                    message: errorObj.message
                }
            }
        };
    }

    /**
     * Returns the user's structure (home) IDs.
     * @param {string} accessToken - The OAuth token to access the Nest API.
     * @param {string} [targetUrl] - The base Nest API URL.
     */
    function getStructures(accessToken, targetUrl = 'https://developer-api.nest.com') {
        return new Promise((resolve, reject) => {
            https.get(getAuthenticatedHttpOptions(targetUrl, accessToken), (res) => {
                res.setEncoding('utf8');
                let data = '';
                // Catch when Nest redirects the API call
                if (res.statusCode === 307) {
                    getStructures(accessToken, res.headers.location).then(resolve).catch(reject);
                } else {
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(data).structures);
                        } else {
                            let errMsg;
                            try {
                                errMsg = JSON.parse(data).message;
                            } catch (e) {
                                errMsg = 'The user\'s structures couldn\'t be determined';
                            }
                            reject({
                                statusCode: res.statusCode,
                                message: errMsg
                            });
                        }
                    });
                }
            }).on('error', (e) => {
                reject(e);
            });
        });
    }

    /**
     * Returns a user's structure's (home) away status.
     * @param {string} structureId - The ID of the structure (home) to get the away status for.
     * @param {string} accessToken - The OAuth token to access the Nest API.
     * @param {string} [targetUrl] - The Nest API URL representing the structure.
     */
    function getAway(structureId, accessToken, targetUrl) {
        return new Promise((resolve, reject) => {
            let options;
            if (targetUrl) {
                options = getAuthenticatedHttpOptions(targetUrl, accessToken);
            } else {
                options = getAuthenticatedHttpOptions(`https://developer-api.nest.com/structures/${structureId}`, accessToken);
            }
            https.get(options, (res) => {
                res.setEncoding('utf8');
                let data = '';
                // Catch when Nest redirects the API call
                if (res.statusCode === 307) {
                    getAway(structureId, accessToken, res.headers.location).then(resolve).catch(reject);
                } else {
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(data).away);
                        } else {
                            let errMsg;
                            try {
                                errMsg = JSON.parse(data).message;
                            } catch (e) {
                                errMsg = `The user\'s structure\'s (${structureId}) away status couldn\'t be determined`;
                            }
                            reject({
                                statusCode: res.statusCode,
                                message: errMsg
                            });
                        }
                    });
                }
            }).on('error', (e) => {
                reject(e);
            });
        });
    }

    /**
     * Sets the away status of a structure (home) and returns the new value.
     * @param {string} awayStatus - The new away status to set the Nest structure (home) to (i.e. home or away).
     * @param {string} structureId - The ID of the structure (home) to get the away status for.
     * @param {string} accessToken - The OAuth token to access the Nest API.
     * @param {string} targetUrl - The Nest API URL representing the structure.
     */
    function setAway(awayStatus, structureId, accessToken, targetUrl) {
        return new Promise((resolve, reject) => {
            let options;
            if (targetUrl) {
                options = getAuthenticatedHttpOptions(targetUrl, accessToken);
            } else {
                options = getAuthenticatedHttpOptions(`https://developer-api.nest.com/structures/${structureId}`, accessToken);
            }
            options.method = 'PUT';

            let req = https.request(options, (res) => {
                res.setEncoding('utf8');
                let data = '';
                // Catch when Nest redirects the API call
                if (res.statusCode === 307) {
                    setAway(awayStatus, structureId, accessToken, res.headers.location).then(resolve).catch(reject);
                } else {
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(data).away);
                        } else {
                            let errMsg;
                            try {
                                errMsg = JSON.parse(data).message;
                            } catch (e) {
                                errMsg = `The user\'s structure\'s (${structureId}) away status couldn\'t be set`;
                            }
                            reject({
                                statusCode: res.statusCode,
                                message: errMsg
                            });
                        }
                    });
                }
            });

            req.on('error', (e) => {
                reject(e);
            });
            req.write(JSON.stringify({
                'away': awayStatus
            }));
            req.end();
        });
    }

    /**
     * Returns the authenticated options used by the Node.js "https" module for a Nest API call.
     * @param {string} targetUrl - The URL to generate the options for.
     * @param {string} accessToken - The OAuth token to access the Nest API.
     */
    function getAuthenticatedHttpOptions(targetUrl, accessToken) {
        const options = url.parse(targetUrl);
        options.headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
        };
        return options;
    }

    /**
     * Returns a JSON representation of an Alexa message without the OAuth token.
     * @param {object} alexaObj - The Alexa message object recieved or being sent back.
     */
    function sanitizeJson(alexaObj) {
        // Create a copy to not overwrite the properties we are modifying
        const rv = JSON.parse(JSON.stringify(alexaObj));
        if (rv.directive) {
            if (rv.directive.endpoint) {
                // Most requests are in this format
                rv.directive.endpoint.scope.token = 'scrubbed';
            } else if (rv.directive.payload) {
                // This is a discover request
                rv.directive.payload.scope.token = 'scrubbed';
            }
        } else if (rv.event) {
            if (rv.event.endpoint) {
                // This is a response
                rv.event.endpoint.scope.token = 'scrubbed';
            }
        }
        return JSON.stringify(rv);
    }

    /**
     * Returns a string format of the error for logging purposes.
     * @param {object} errorObj - The error object.
     */
    function getLoggableError(errorObj) {
        try {
            return JSON.stringify(errorObj);
        } catch(exc) {
            return errorObj.message;
        }
    }
};
