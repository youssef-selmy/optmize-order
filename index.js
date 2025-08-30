// 015-exported-functions.js (Original: index.js)
// Import Firebase config first to ensure admin SDK is initialized
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path

// Import all service classes and utilities
const AdvancedSecurityManager = require('./016-advanced-security-auth'); // Updated path
const AIFraudDetection = require('./018-ai-fraud-detection'); // Updated path
const AdvancedCacheManager = require('./026-advanced-cache-manager'); // Updated path
const AdvancedNotificationService = require('./022-multi-channel-notifications'); // Updated path
const AdvancedAnalytics = require('./019-advanced-analytics-monitoring'); // Updated path
const AutoCleanupService = require('./029-auto-cleanup-service'); // Updated path
const BackgroundJobScheduler = require('./030-background-job-scheduler'); // Updated path
// CacheManager is assumed to be imported internally where needed, or from 003-utilities-helpers.js if basic version
const CircuitBreakerErrorHandler = require('./028-error-handler-circuit-breaker'); // Updated path
const EnhancedSecurityMonitoring = require('./025-enhanced-security-monitoring'); // Updated path
const OptimizedDriverSearch = require('./023-optimized-driver-search'); // Updated path
const PerformanceMonitor = require('./027-performance-monitor'); // Updated path
const PredictiveAnalytics = require('./020-predictive-analytics'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const SmartDriverMatching = require('./021-smart-driver-matching'); // Updated path
const SmartResourceManager = require('./024-smart-resource-management'); // Updated path
const { ORDER_STATUS, SECURITY_CONFIG } = require('./002-constants-definition'); // Updated path
const { distanceRadius, getAvailableDrivers, getDriverNearByData } = require('./003-utilities-helpers'); // Updated path


// --- IMPORTANT: Initialize static properties and schedule system jobs ---
// These ensure that Maps are populated, rules are set, and background tasks are registered.
// This should be done only once when the function instance starts up.
console.log('Initializing system services...');
AutoCleanupService.initialize(); // Initializes cleanup rules
BackgroundJobScheduler.initializeSystemJobs(); // Schedules all recurring background jobs

// Start the job scheduler's internal loop
// For a typical GCF, scheduled jobs are better triggered by Cloud Scheduler -> Pub/Sub -> GCF.
// BUT, to keep the spirit of the `BackgroundJobScheduler` class, we start it here.
BackgroundJobScheduler.startScheduler(5000); // Check every 5 seconds for jobs

// --- Cloud Function Exports ---

// Example HTTP function: Trigger an order dispatch process
exports.dispatchOrder = _functions.https.onCall(async (data, context) => {
    try {
        console.log('--- Order Dispatch Requested ---');
        // Example: Validate user access
        const userData = await AdvancedSecurityManager.validateAdvancedSecurity(context, {
            requireGeoValidation: true,
            requireDeviceFingerprint: false
        });
        console.log('User validated:', userData.uid);

        // Example: Track order flow
        await AdvancedAnalytics.trackOrderFlowMetrics(data.orderId, 'dispatch_requested', { userId: userData.uid });

        // Example: Use resource management (acquire concurrent dispatch slot)
        const resource = await SmartResourceManager.acquireResource('activeDispatch', 1);
        try {
            // Simulate fetching order data and available drivers
            const orderData = {
                orderId: data.orderId,
                vendorID: 'vendorA',
                vendor: { latitude: 34.05, longitude: -118.25 }, // Example vendor location
                author: { uid: userData.uid }
            };
            const dispatchMetadata = {
                zone_id: 'zone1',
                currentRound: 1,
                kDistanceRadiusForDispatchInMiles: 10
            };

            // Enhanced driver search and matching
            const availableDrivers = await OptimizedDriverSearch.getAvailableDriversOptimized(data.orderId, orderData, dispatchMetadata);
            const optimalDrivers = await SmartDriverMatching.findOptimalDriver(orderData, availableDrivers, { weather: { condition: 'clear' }, traffic: { level: 'light' } });

            if (optimalDrivers.length === 0) {
                await AdvancedNotificationService.sendMultiChannelNotification(
                    userData,
                    { title: 'Order Update', body: `No drivers available for your order ${data.orderId}.` },
                    'normal', await AdvancedNotificationService.getOptimalNotificationChannels(userData, {}, 'normal')
                );
                throw new _functions.https.HttpsError('not-found', 'No optimal drivers found.');
            }

            const chosenDriver = optimalDrivers[0];
            console.log(`Optimal driver for order ${data.orderId}: ${chosenDriver.id} with score ${chosenDriver.matchScore}`);

            // Simulate sending notification to driver
            await AdvancedNotificationService.sendMultiChannelNotification(
                { id: chosenDriver.id, fcmToken: 'mock_driver_fcm_token_123', phoneNumber: '+1234567890', email: 'driver@example.com' }, // Driver recipient
                { title: 'New Delivery Request', body: `You have a new delivery request for order ${data.orderId}. Pickup from VendorA.`, data: { orderId: data.orderId } },
                'high', await AdvancedNotificationService.getOptimalNotificationChannels({ role: 'driver', fcmToken: 'mock_driver_fcm_token_123' }, {}, 'high')
            );
            await AdvancedAnalytics.trackOrderFlowMetrics(data.orderId, 'driver_assigned', { driverId: chosenDriver.id });

            // Example: Detect potential fraud (this would typically run after certain actions)
            await AIFraudDetection.calculateFraudScore(userData.uid, 'place_order', { clientIP: context.rawRequest.ip });

            // Example: Enhanced security monitoring
            await EnhancedSecurityMonitoring.detectAdvancedThreats(userData.uid, 'dispatch_order', { clientIP: context.rawRequest.ip, userAgent: context.rawRequest.headers['user-agent'] });

            return { success: true, message: `Order ${data.orderId} dispatched to ${chosenDriver.id}` };

        } catch (innerError) {
            console.error('Error during dispatch process:', innerError);
            throw innerError; // Re-throw to be caught by outer try-catch
        } finally {
            resource.release(); // Ensure resource is released
        }

    } catch (error) {
        console.error('Cloud Function failed:', error);
        // Ensure HttpsError is returned if it's one, otherwise wrap it
        if (error instanceof _functions.https.HttpsError) {
            throw error;
        }
        throw new _functions.https.HttpsError('internal', 'An unexpected error occurred: ' + error.message);
    }
});

// Example HTTP function: Get system status
exports.getSystemStatus = _functions.https.onCall(async (data, context) => {
    try {
        if (!context.auth || !context.auth.token.admin) { // Example: Only admins can call this
            throw new _functions.https.HttpsError('permission-denied', 'Only admin users can retrieve system status.');
        }

        const performanceReport = PerformanceMonitor.getPerformanceReport();
        const securityMetrics = EnhancedSecurityMonitoring.getSecurityMetrics();
        const cleanupStatus = AutoCleanupService.getCleanupStatus();
        const resourceStatus = SmartResourceManager.getResourceStatus();
        const circuitBreakerStatus = CircuitBreakerErrorHandler.getCircuitBreakerStatus();
        const jobSchedulerStatus = BackgroundJobScheduler.getJobStatus();
        const cacheStatus = AdvancedCacheManager.getCacheStatistics();
        const spatialIndexStats = OptimizedDriverSearch.getSpatialIndexStatistics();

        return {
            performance: performanceReport,
            security: securityMetrics,
            cleanup: cleanupStatus,
            resources: resourceStatus,
            circuitBreakers: circuitBreakerStatus,
            jobs: jobSchedulerStatus,
            cache: cacheStatus,
            spatialIndex: spatialIndexStats,
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

// Pub/Sub function example: Trigger daily reports
// This function would be triggered by Cloud Scheduler publishing a message to 'daily-reports-topic'
exports.dailyReportGenerator = _functions.pubsub.topic('daily-reports-topic').onPublish(async (message, context) => {
    console.log('Daily report generation triggered by Pub/Sub.');
    try {
        await PerformanceMonitor.generateReport();
        await EnhancedSecurityMonitoring.generateSecurityReport('24h');
        await PredictiveAnalytics.predictOrderDemand('24h');
        await PredictiveAnalytics.predictDriverUtilization();
        console.log('Daily reports generated successfully.');
        return null;
    } catch (error) {
        console.error('Error generating daily reports:', error);
        // Cloud Functions for background triggers should not re-throw errors
        // if you don't want the message re-delivered by Pub/Sub.
        // For fatal errors, you might want it to retry.
        throw error; // Re-throw to indicate failure, Pub/Sub will retry
    }
});