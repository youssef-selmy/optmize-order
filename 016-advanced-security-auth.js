// 016-advanced-security-auth.js (Original: AdvancedSecurityManager.js)
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-redis-caching-performance'); // Assuming SecurityLogger.js is renamed to '017-security-logger.js' or has a path adjusted.

/**
 * Advanced Security Manager with IP tracking, Device fingerprinting, Geofencing
 */
class AdvancedSecurityManager {
    static suspiciousIPs = new Set(); // In-memory for current process, could be persistent
    static blockedCountries = ['CN', 'RU', 'KP'];
    static allowedCountries = ['DE', 'AT', 'CH', 'FR', 'BE', 'NL'];

    static async validateAdvancedSecurity(context, options = {}) {
        const {
            requireGeoValidation = false,
            // allowedRoles = [], // Not used in provided snippet
            // maxRequestsPerMinute = 60, // Not used in provided snippet
            requireDeviceFingerprint = false
        } = options;

        if (!context.auth || !context.auth.uid) {
            throw new _functions.https.HttpsError('unauthenticated', 'Authentication required');
        }

        const clientIP = this.extractClientIP(context);
        const userAgent = context.rawRequest?.headers['user-agent'] || 'unknown';
        const deviceFingerprint = context.rawRequest?.headers['x-device-fingerprint'];

        await this.validateClientIP(clientIP, context.auth.uid);

        if (requireDeviceFingerprint && !deviceFingerprint) {
            throw new _functions.https.HttpsError('permission-denied', 'Device verification required');
        }

        const userDoc = await _firestore.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new _functions.https.HttpsError('not-found', 'User profile not found');
        }

        const userData = userDoc.data();

        await this.checkAccountSecurity(userData, context.auth.uid);
        await this.checkGeoSecurity(userData, clientIP, requireGeoValidation);
        await this.logSecurityEvent(context.auth.uid, 'function_access', {
            clientIP,
            userAgent,
            deviceFingerprint: deviceFingerprint ? 'present' : 'missing'
        });

        return userData;
    }

    static extractClientIP(context) {
        const req = context.rawRequest;
        return req.headers?.['x-forwarded-for']?.split(',')[0] ||
            req.headers?.['x-real-ip'] ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            'unknown';
    }

    static async validateClientIP(clientIP, userId) {
        if (this.suspiciousIPs.has(clientIP)) {
            await SecurityLogger.logCriticalAction(userId, 'blocked_ip_attempt', { clientIP });
            throw new _functions.https.HttpsError('permission-denied', 'Access denied from this IP');
        }

        const requestCount = await this.getIPRequestCount(clientIP);
        if (requestCount > 5) { // Reduced from 100 for easier testing
            this.suspiciousIPs.add(clientIP);
            await SecurityLogger.logCriticalAction(userId, 'ip_rate_limit_exceeded', {
                clientIP,
                requestCount
            });
            throw new _functions.https.HttpsError('resource-exhausted', 'Too many requests');
        }
    }

    static async getIPRequestCount(clientIP) {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        try {
            const snapshot = await _firestore.collection('ip_requests')
                .where('ip', '==', clientIP)
                .where('timestamp', '>=', oneMinuteAgo)
                .get();

            // Record this request
            await _firestore.collection('ip_requests').add({
                ip: clientIP,
                timestamp: now
            });

            return snapshot.size;
        } catch (error) {
            console.error("Error getting IP request count:", error);
            return 0;
        }
    }

    static async checkAccountSecurity(userData, userId) {
        if (userData.banned === true) {
            // await SecurityLogger.logCriticalAction(userId, 'banned_account_access_attempt');
            throw new _functions.https.HttpsError('permission-denied', 'Account is banned');
        }

        if (userData.suspended === true) {
            // await SecurityLogger.logCriticalAction(userId, 'suspended_account_access_attempt');
            throw new _functions.https.HttpsError('permission-denied', 'Account is suspended');
        }

        if (userData.flaggedForReview === true) {
            await SecurityLogger.logCriticalAction(userId, 'flagged_account_access_attempt');
            throw new _functions.https.HttpsError('permission-denied', 'Account under review');
        }
    }

    static async checkGeoSecurity(userData, clientIP, requireGeoValidation) {
        if (!requireGeoValidation) return;

        try {
            const geoData = await this.getIPGeolocation(clientIP);

            if (this.blockedCountries.includes(geoData.country)) {
                await SecurityLogger.logCriticalAction(userData.uid || 'unknown', 'blocked_country_access', {
                    country: geoData.country,
                    clientIP
                });
                throw new _functions.https.HttpsError('permission-denied', 'Access not allowed from this region');
            }
        } catch (error) {
            console.log('Geo validation failed:', error.message);
        }
    }

    // Mock implementation for demonstration
    static async getIPGeolocation(clientIP) {
        console.log(`MOCK: Getting geolocation for IP: ${clientIP}`);
        if (clientIP === '1.2.3.4') return { country: 'KP', city: 'Pyongyang', region: 'Pyongyang' }; // Mock blocked country
        if (clientIP === '5.6.7.8') return { country: 'DE', city: 'Berlin', region: 'Berlin' }; // Mock allowed country
        return {
            country: 'US', // Default mock country
            city: 'Unknown',
            region: 'Unknown'
        };
    }

    static async logSecurityEvent(userId, event, metadata = {}) {
        await _firestore.collection('security_events').add({
            userId,
            event,
            metadata,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            ip: metadata.clientIP || 'unknown'
        });
    }
}

module.exports = AdvancedSecurityManager;