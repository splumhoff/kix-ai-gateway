/**
 * KIX-AI-Gateway: Gateway for ticket analysis and summary generation.
 *
 * This software receives a ticket number, retrieves ticket data from the KIX API,
 * summarizes the ticket using Azure OpenAI, and updates a dynamic field in the ticket
 * with the generated summary.
 *
 * Environment Variables:
 * - KIX_API_URL: Base URL for the KIX API.
 * - KIX_API_USER_NAME: Username for KIX API authentication.
 * - KIX_API_USER_PASS: Password for KIX API authentication.
 * - AZURE_OPENAI_ENDPOINT: Endpoint for Azure OpenAI API.
 * - AZURE_OPENAI_API_KEY: API key for Azure OpenAI.
 * - AZURE_OPENAI_DEPLOYMENT_NAME: Deployment name for Azure OpenAI.
 * - KIX_SUMMARY_FIELD (optional): Name of the dynamic field to update with the summary.
 * - AZURE_OPENAI_API_VERSION (optional): Version of the Azure OpenAI API.
 * - AZURE_OPENAI_TEMPERATURE (optional): Temperature setting for OpenAI completions.
 * - AZURE_OPENAI_PROMPT (optional): Default prompt for summarization.
 *
 * Endpoints:
 * POST /azureopenai/tickets/:ticketId/analyze
 *   - Analyzes the specified ticket and updates its dynamic field with an AI-generated summary.
 *   - Request Body:
 *     - dynamic_field (string, optional): Name of the dynamic field to update.
 *     - ai_prompt (string, optional): Custom prompt for the AI summarization.
 *     - reduce_metadata (boolean, optional): Whether to reduce ticket metadata before summarization.
 *     - ai_temperature (float, optional): Temperature for the AI model.
 *
 * Functions:
 * - reduceTicket(rawTicket): Reduces a raw ticket object to a simplified version.
 * - getKIXAuthToken(): Retrieves an authentication token from the KIX API.
 * - getKIXTicketContent(kixAuthToken, ticketId): Retrieves ticket content including articles.
 * - getAzureOpenAIResponse(ticketId, ticketData, prompt, temperature): Sends a chat completion request to Azure OpenAI.
 * - updateKixTicketDynamicField(kixAuthToken, ticketId, dynamicFieldName, content): Updates a dynamic field of a KIX ticket.
 *
 * Error Handling:
 * - Logs errors and returns appropriate HTTP status codes for authentication, ticket retrieval, and AI processing failures.
 *
 * Usage:
 * - Start the server and POST to /azureopenai/tickets/:ticketId/analyze to trigger ticket analysis and summary generation.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const { AzureOpenAI } = require('openai');
require('dotenv').config();

// Check required Parameters
const requiredParameters = [
    'KIX_API_URL',
    'KIX_API_USER_NAME',
    'KIX_API_USER_PASS',
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_DEPLOYMENT_NAME'
];
const missingParameter = requiredParameters.filter(p => !process.env[p]);
if (missingParameter.length) {
    console.error(`Missing Parameters: ${missingParameter.join(', ')}`);
    process.exit(1);
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const KIX_API_URL = process.env.KIX_API_URL;
const KIX_API_USER_NAME = process.env.KIX_API_USER_NAME;
const KIX_API_USER_PASS = process.env.KIX_API_USER_PASS;
const KIX_SUMMARY_FIELD = process.env.KIX_SUMMARY_FIELD || 'AI_Summary';
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_DEPLOYMENT_NAME = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
const AZURE_OPENAI_TEMPERATURE = process.env.AZURE_OPENAI_TEMPERATURE || '0.3';
const AZURE_OPENAI_PROMPT = process.env.AZURE_OPENAI_PROMPT || `JSON input contains ticket header and articles.
Each article has a Body (message text) and SenderType (external or internal).

Summarize in the following format. Use max 2 sentences per article (not per person).
Allow ckeditor formatting.

Format:

Request:
Short summary of initial request.

Current Status:
Brief status of the ticket.

Communication History:
[Date] (external/internal): Summary

Potential Solution Approaches:
Possible solutions or next steps.
`;

/**
 * Reduces a raw ticket object to a simplified ticket object with selected fields.
 *
 * @param {Object} rawTicket - The raw ticket object to reduce.
 * @returns {Object} The reduced ticket object containing selected fields and simplified articles.
 */
function reduceTicket(rawTicket) {
    const {
        TicketID,
        TicketNumber,
        Title,
        Created,
        Changed,
        Articles
    } = rawTicket;

    return {
        TicketID,
        TicketNumber,
        Title,
        Created,
        Changed,
        Articles: Articles.map(article => ({
            ArticleID: article.ArticleID,
            CreateTime: article.CreateTime,
            From: article.From,
            To: article.To,
            Subject: article.Subject,
            Body: article.Body,
            CustomerVisible: article.CustomerVisible,
            SenderType: article.SenderType
        }))
    };
}

/**
 * Asynchronously retrieves an authentication token from the KIX API.
 *
 * Sends a POST request to the KIX API's authentication endpoint using the provided
 * user credentials and returns the authentication token if successful.
 *
 * @async
 * @function
 * @returns {Promise<string|undefined>} The authentication token if successful, otherwise undefined.
 */
async function getKIXAuthToken() {
    try {
        // Auth Token holen
        const tokenResp = await axios.post(`${KIX_API_URL}/auth`, {
            UserLogin: `${KIX_API_USER_NAME}`, Password: `${KIX_API_USER_PASS}`, UserType: `Agent`
        });
        const authToken = tokenResp.data.Token;
        if (!authToken) {
            console.error(`Failed to get KIX Auth Token`);
            return;
        }
        return authToken;
    } catch (error){
        console.error(`Failed to get KIX Auth Token`);
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('Full error object:', error);
        return;
    }
}

/**
 * Retrieves the content of a KIX ticket, including its articles.
 * 
 * @param {string} kixAuthToken - The authentication token for the KIX API.
 * @param {number} ticketId - The ID of the ticket to retrieve.
 * @returns {Promise<Object|undefined>} The ticket data if found, otherwise undefined.
 */
async function getKIXTicketContent(kixAuthToken, ticketId) {
    try {
        const ticketResp = await axios.get(`${KIX_API_URL}/tickets/${ticketId}?include=Articles`, {
            headers: { Authorization: `Token ${kixAuthToken}` }
        });
        if (!ticketResp.data.Ticket)
            console.log(`Failed to get KIX Ticket with ID ${ticketId}`);
        console.info(`Ticket ${ticketId} successfully received`);
        return ticketResp.data.Ticket;
    } catch (error){
        console.error(`Failed to get KIX Ticket with ID ${ticketId}`);
        console.error('Error:', error.message);
        return;
    }

}

/**
 * Sends a chat completion request to Azure OpenAI and returns the generated response summary.
 *
 * @async
 * @function getAzureOpenAIResponse
 * @param {number} ticketId - The unique identifier for the ticket.
 * @param {Object} ticketData - The data associated with the ticket to be sent as user input.
 * @param {string} prompt - The system prompt to guide the OpenAI model's response.
 * @param {number} temperature - The temperature setting for the OpenAI model (controls randomness).
 * @returns {Promise<string|undefined>} The summary response from Azure OpenAI, or undefined if an error occurs.
 */
async function getAzureOpenAIResponse(ticketId, ticketData, prompt, temperature) {
    try {
        const openAIClient = new AzureOpenAI({ endpoint: AZURE_OPENAI_ENDPOINT, deployment: AZURE_OPENAI_DEPLOYMENT_NAME, apiVersion: AZURE_OPENAI_API_VERSION, apiKey: AZURE_OPENAI_API_KEY });
        console.info(`Sending Azure OpenAI Request for Ticket ${ticketId}`);
        const openAIResponse = await openAIClient.chat.completions.create({
            temperature: temperature,
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: JSON.stringify(ticketData) },
            ],

        });
        const summary = openAIResponse.choices?.[0]?.message?.content;
        if (!summary)
            throw new Error(`No answer for Ticket ${ticketId} received`);
        return summary;
    } catch (error) {
        console.error(`Failed to get KIX Ticket with ID ${ticketId}`);
        console.error('Error:', error.message);
        return;
    }
}
/**
 * Updates a dynamic field of a KIX ticket with the specified content.
 * 
 * @param {string} kixAuthToken - The authentication token for the KIX API.
 * @param {number} ticketId - The ID of the ticket to update.
 * @param {string} dynamicFieldName - The name of the dynamic field to update.
 * @param {string} content - The content to set for the dynamic field.
 */
async function updateKixTicketDynamicField(kixAuthToken, ticketId, dynamicFieldName, content) {
    console.log(`Updating KIX Ticket ${ticketId}, Dynamic Field ${dynamicFieldName}`)
    axios.patch(`${KIX_API_URL}/tickets/${ticketId}`, {
        Ticket: {
            DynamicFields: [{ Name: dynamicFieldName, Value: content }]
        }
    }, {
        headers: { Authorization: `Token ${kixAuthToken}` }
    }).catch(function (error){
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log(error.response.data);
            console.log(error.response.status);
            console.log(error.response.headers);
        } else if (error.request) {
            console.log(error.request);
        } else {
            console.log('Error', error.message);
        }
        console.log(error.config);
    });
}

// Checks if the ticketId is a valid number before processing the request.
app.param('ticketId', (req, res, next, ticketId) => {
    // Validate ticketId to be a number
    if (!/^\d+$/.test(ticketId)) {
        return res.status(400).json({ message: 'Invalid ticketId format. It should be a number.' });
    }
    next();
}); 

app.post('/azureopenai/tickets/:ticketId/analyze', [
        body('dynamic_field').optional().isString().withMessage('dynamic_field must be a string'),
        body('ai_prompt').optional().isString().withMessage('ai_prompt must be a string'),
        body('reduce_metadata').optional().isBoolean().withMessage('reduce_metadata must be a boolean'),
        body('ai_temperature').optional().isFloat({ min: 0 }).withMessage('ai_temperature must be a float >0')
    ], async (req, res) => {
    const kix_ticket_id = req.params.ticketId;
    const kix_dynamic_field_name = req.body?.dynamic_field || KIX_SUMMARY_FIELD;
    const azure_openai_prompt = req.body?.ai_prompt || AZURE_OPENAI_PROMPT;
    let reduce_metadata = true;
    if (typeof req.body?.reduce_metadata === 'string') {
        reduce_metadata = req.body?.reduce_metadata.toLowerCase() !== 'false';
    } else if (typeof req.body?.reduce_metadata === 'boolean') {
        reduce_metadata = req.body?.reduce_metadata;
    }
    const azure_openai_temperature = parseFloat(req.body?.ai_temperature || AZURE_OPENAI_TEMPERATURE);

    const valErrors = validationResult(req);
    if (!valErrors.isEmpty()) {
        return res.status(400).json({ errors: valErrors.array() });
    }

    const kixAuthToken = await getKIXAuthToken();
    if (!kixAuthToken) {
        res.status(500).json({ message: 'Auth. to KIX API failed.'});
        return;
    }
    var kixTicket = await getKIXTicketContent(kixAuthToken, kix_ticket_id);
    if (!kixTicket) {
        res.status(404).json({ message: `Ticket with ID ${kix_ticket_id} not found.` });
        return;
    } else
        res.status(202).json({ message: 'Ticket found, processing...' });
    
    if (reduce_metadata)
        kixTicket = reduceTicket(kixTicket);

    const aiResponse = await getAzureOpenAIResponse(kix_ticket_id, kixTicket, azure_openai_prompt, azure_openai_temperature);
    if (!aiResponse) {
        console.error(`Failed to get Azure OpenAI Respnse for Ticket with ID ${kix_ticket_id}`);
        return;
    }
    await updateKixTicketDynamicField(kixAuthToken, kix_ticket_id, kix_dynamic_field_name, aiResponse);
});

// Health check endpoint to verify that the middleware is running.
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Start the Express server for KIX-AI-Gateway, which handles ticket analysis and summary generation.
app.listen(PORT, () => {
    console.log(`KIX-AI-Gateway is running on Port ${PORT}`);
});
