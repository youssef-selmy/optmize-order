// 031-integration-manager.js
// Placeholder for integrating all services.
class IntegrationManager {
    static async initializeAllServices() {
        console.log("Initializing all system integrations...");
        // Calls initialization methods of various services if they have them
        // e.g., AutoCleanupService.initialize(), BackgroundJobScheduler.startScheduler()
        // NOTE: Update require paths if these services were moved.
        const AutoCleanupService = require('./029-auto-cleanup-service');
        const BackgroundJobScheduler = require('./030-background-job-scheduler');

        AutoCleanupService.initialize();
        BackgroundJobScheduler.startScheduler();
    }
}
module.exports = IntegrationManager;