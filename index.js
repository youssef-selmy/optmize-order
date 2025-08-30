// index.js

// Import Firebase Admin SDK and Functions SDK
// Make sure you have initialized Firebase Admin in 001-setup-initialization.js
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Assuming this correctly initializes Firebase Admin

// Import all service classes and utilities
// Ensure paths are correct relative to index.js
const AdvancedSecurityManager = require('./016-advanced-security-auth');
const AIFraudDetection = require('./018-ai-fraud-detection');
const AdvancedCacheManager = require('./026-advanced-cache-manager');
const AdvancedNotificationService = require('./022-multi-channel-notifications');
const AdvancedAnalytics = require('./019-advanced-analytics-monitoring');
const AutoCleanupService = require('./029-auto-cleanup-service');
const BackgroundJobScheduler = require('./030-background-job-scheduler');
const CircuitBreakerErrorHandler = require('./028-error-handler-circuit-breaker');
const EnhancedSecurityMonitoring = require('./025-enhanced-security-monitoring');
const OptimizedDriverSearch = require('./023-optimized-driver-search');
const PerformanceMonitor = require('./027-performance-monitor');
const PredictiveAnalytics = require('./020-predictive-analytics');
const SecurityLogger = require('./017-security-logger');
const SmartDriverMatching = require('./021-smart-driver-matching');
const SmartResourceManager = require('./024-smart-resource-management');
const { ORDER_STATUS, SECURITY_CONFIG } = require('./002-constants-definition');
const { distanceRadius, getAvailableDrivers, getDriverNearByData } = require('./003-utilities-helpers');

// --- IMPORTANT: Initialization and Background Job Scheduling ---
// Code here runs ONCE when a function instance starts.
// Be mindful of the ephemeral nature of GCF instances for background jobs.
console.log('Initializing system services for Firebase Functions runtime...');
try {
    // Initialize any services that need to run when the instance starts.
    // Make sure these are compatible with Firebase Admin SDK.
    AutoCleanupService.initialize();
    BackgroundJobScheduler.initializeSystemJobs();
    // For background jobs that need to run periodically, consider using Cloud Scheduler -> Pub/Sub
    // or Firebase Scheduled Functions if available/suitable.
    // BackgroundJobScheduler.startScheduler(5000); // Use with caution in GCF.
    console.log('Firebase Functions system services initialized.');
} catch (error) {
    console.error('Error during Firebase Functions system service initialization:', error);
    // If critical services fail to initialize, you might want to exit or throw an error.
    // In GCF, unhandled errors can lead to instance restarts or the function becoming unhealthy.
}

// --- Cloud Function Exports (using Firebase Functions SDK) ---

/**
 * HTTP Callable Function: Trigger an order dispatch process.
 * Uses Firebase Auth context.
 */
exports.dispatchOrder = _functions.https.onCall(async (data, context) => {
    // --- Authentication ---
    // Firebase automatically provides user auth context if callable function is called with auth token.
    if (!context.auth) {
        console.error('User is not authenticated.');
        throw new _functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const uid = context.auth.uid;
    console.log(`User ${uid} is dispatching order.`);

    // --- Accessing Request Data ---
    // For onCall, data is passed as the first argument.
    const orderId = data.orderId;
    if (!orderId) {
        console.error('Missing orderId in function call data.');
        throw new _functions.https.HttpsError('invalid-argument', 'Missing orderId in function call data.');
    }
    console.log(`Processing order ID: ${orderId}`);

    try {
        // --- Example Logic (assuming your modules work with Firebase Admin/Functions context) ---
        const userData = await AdvancedSecurityManager.validateAdvancedSecurity(context, { /* ... */ });
        console.log('User validated:', userData.uid);

        await AdvancedAnalytics.trackOrderFlowMetrics(orderId, 'dispatch_requested', { userId: userData.uid });

        const orderData = {
            orderId: orderId,
            vendorID: 'vendorA',
            vendor: { latitude: 34.05, longitude: -118.25 },
            author: { uid: userData.uid }
        };
        const dispatchMetadata = {
            zone_id: 'zone1',
            currentRound: 1,
            kDistanceRadiusForDispatchInMiles: 10
        };

        const availableDrivers = await OptimizedDriverSearch.getAvailableDriversOptimized(orderId, orderData, dispatchMetadata);
        const optimalDrivers = await SmartDriverMatching.findOptimalDriver(orderData, availableDrivers, { weather: { condition: 'clear' }, traffic: { level: 'light' } });

        if (optimalDrivers.length === 0) {
            throw new _functions.https.HttpsError('not-found', `No drivers available for order ${orderId}.`);
        }

        const chosenDriver = optimalDrivers[0];
        console.log(`Optimal driver for order ${orderId}: ${chosenDriver.id}`);

        // Use Firebase Admin SDK for operations if needed by your modules
        // Example: const docRef = _firestore.collection('orders').doc(orderId);
        // await docRef.update({ status: ORDER_STATUS.DISPATCHED, driverId: chosenDriver.id });

        // Send notification (ensure your service works with driver data)
        // await AdvancedNotificationService.sendMultiChannelNotification(...);

        return { success: true, message: `Order ${orderId} dispatched to ${chosenDriver.id}` };

    } catch (error) {
        console.error('Cloud Function dispatchOrder failed:', error);
        // Rethrow HttpsError or wrap other errors
        if (error instanceof _functions.https.HttpsError) {
            throw error;
        }
        throw new _functions.https.HttpsError('internal', 'An unexpected error occurred: ' + error.message);
    }
});

/**
 * HTTP Callable Function: Get system status.
 * Example of an admin-only callable function.
 */
exports.getSystemStatus = _functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new _functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    // Example admin check: You might add a custom claim 'admin: true' to the user's token.
    const isAdmin = context.auth.token.admin === true;
    if (!isAdmin) {
        throw new _functions.https.HttpsError('permission-denied', 'User is not an admin.');
    }

    console.log('Admin user fetching system status.');
    try {
        const performanceReport = PerformanceMonitor.getPerformanceReport ? PerformanceMonitor.getPerformanceReport() : { status: 'N/A' };
        // ... fetch other statuses ...

        return {
            performance: performanceReport,
            message: 'System status retrieved successfully'
        };
    } catch (error) {
        console.error('getSystemStatus failed:', error);
        if (error instanceof _functions.https.HttpsError) {
            throw error;
        }
        throw new _functions.https.HttpsError('internal', 'Failed to retrieve system status: ' + error.message);
    }
});

/**
 * Pub/Sub triggered Cloud Function: Trigger daily reports.
 * This function is triggered by a Pub/Sub message.
 */
exports.dailyReportGenerator = _functions.pubsub.topic('daily-reports-topic').onPublish(async (message, context) => {
    console.log('Daily report generation triggered by Pub/Sub.');
    try {
        // Your reporting logic here. Ensure it's compatible with Firebase Functions context.
        // await PerformanceMonitor.generateReport();
        // await EnhancedSecurityMonitoring.generateSecurityReport('24h');
        console.log('Daily reports generation process initiated.');
        return null; // Acknowledge Pub/Sub message.
    } catch (error) {
        console.error('Error generating daily reports:', error);
        // Throw to cause Pub/Sub to retry the message.
        throw error;
    }
});
