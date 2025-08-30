// 014-cloud-functions-definitions.js
// Placeholder for defining custom cloud function structures or wrappers.
// Example: A wrapper for all HTTP functions to apply common middleware.
const { _functions } = require('./001-setup-initialization'); // Updated path

function wrapHttpFunction(handler) {
    return _functions.https.onRequest(async (req, res) => {
        // Common middleware logic here (e.g., CORS, common auth checks)
        console.log(`HTTP Request: ${req.method} ${req.url}`);
        try {
            await handler(req, res);
        } catch (error) {
            console.error("HTTP handler error:", error);
            res.status(500).send("Internal Server Error");
        }
    });
}

module.exports = { wrapHttpFunction };
