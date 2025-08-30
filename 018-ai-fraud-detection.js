// 018-ai-fraud-detection.js (Original: AIFraudDetection.js)
const { _admin, _firestore } = require('./001-setup-initialization'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const CacheManager = require('./CacheManager'); // For potential customer preferences/device data - Assuming CacheManager.js is renamed correctly
const AdvancedSecurityManager = require('./016-advanced-security-auth'); // Assuming its path is updated correctly.

class AIFraudDetection {
    static fraudScoreThresholds = {
        LOW: 30,
        MEDIUM: 60,
        HIGH: 80,
        CRITICAL: 95
    };

    static async calculateFraudScore(userId, activity, contextData = {}) {
        let score = 0;
        const factors = [];

        const velocityScore = await this.checkVelocityPatterns(userId, activity);
        score += velocityScore;
        if (velocityScore > 0) factors.push(`velocity: ${velocityScore}`);

        const behaviorScore = await this.checkBehaviorPatterns(userId, activity, contextData);
        score += behaviorScore;
        if (behaviorScore > 0) factors.push(`behavior: ${behaviorScore}`);

        const deviceScore = await this.checkDeviceConsistency(userId, contextData);
        score += deviceScore;
        if (deviceScore > 0) factors.push(`device: ${deviceScore}`);

        const timeScore = this.checkTimePatterns(activity, contextData);
        score += timeScore;
        if (timeScore > 0) factors.push(`time: ${timeScore}`);

        const locationScore = await this.checkLocationAnomalies(userId, contextData);
        score += locationScore;
        if (locationScore > 0) factors.push(`location: ${locationScore}`);

        const finalScore = Math.min(score, 100);

        await this.logFraudScore(userId, activity, finalScore, factors);

        if (finalScore >= this.fraudScoreThresholds.CRITICAL) {
            await this.handleCriticalFraud(userId, activity, finalScore, factors);
        } else if (finalScore >= this.fraudScoreThresholds.HIGH) {
            await this.handleHighFraud(userId, activity, finalScore, factors);
        }

        return finalScore;
    }

    static async checkVelocityPatterns(userId, activity) {
        const now = Date.now();
        const last5Minutes = now - (5 * 60 * 1000);

        try {
            const recentActivities = await _firestore.collection('user_activities')
                .where('userId', '==', userId)
                .where('timestamp', '>=', last5Minutes) // Firestore timestamps should be comparable to numbers
                .get();

            const actionCounts = {};
            recentActivities.docs.forEach(doc => {
                const data = doc.data();
                actionCounts[data.action] = (actionCounts[data.action] || 0) + 1;
            });

            let score = 0;

            if (actionCounts[activity] > 10) score += 40;
            else if (actionCounts[activity] > 5) score += 20;

            const uniqueActions = Object.keys(actionCounts).length;
            if (uniqueActions > 8) score += 30;

            return score;
        } catch (error) {
            console.error("Error checking velocity patterns:", error);
            return 0;
        }
    }

    static async checkBehaviorPatterns(userId, activity, contextData) {
        let score = 0;

        try {
            const historicalSnapshot = await _firestore.collection('user_behavior_patterns')
                .doc(userId).get();

            if (!historicalSnapshot.exists) {
                return 10; // New user, slight risk
            }

            const patterns = historicalSnapshot.data();

            const typicalActivityFreq = patterns.activities?.[activity] || 0;
            if (typicalActivityFreq === 0 && activity === 'high_value_order') {
                score += 25; // Unusual high value order activity
            }

            const currentHour = new Date().getHours();
            const userTypicalHours = patterns.activeHours || [];
            if (!userTypicalHours.includes(currentHour)) {
                score += 15; // Activity outside typical hours
            }

            return score;
        } catch (error) {
            console.error("Error checking behavior patterns:", error);
            return 0;
        }
    }

    static async checkDeviceConsistency(userId, contextData) {
        const { clientIP, userAgent, deviceFingerprint } = contextData;
        let score = 0;

        try {
            const recentDevices = await _firestore.collection('user_devices')
                .where('userId', '==', userId)
                .orderBy('lastSeen', 'desc')
                .limit(5)
                .get();

            if (recentDevices.empty) {
                return 15; // No known devices, could be new or suspicious
            }

            const knownIPs = new Set();
            const knownUserAgents = new Set();
            const knownFingerprints = new Set();

            recentDevices.docs.forEach(doc => {
                const data = doc.data();
                if (data.ip) knownIPs.add(data.ip);
                if (data.userAgent) knownUserAgents.add(data.userAgent);
                if (data.fingerprint) knownFingerprints.add(data.fingerprint);
            });

            if (clientIP && !knownIPs.has(clientIP)) {
                score += 20; // New IP
            }

            if (userAgent && !knownUserAgents.has(userAgent)) {
                score += 15; // New User Agent
            }

            if (deviceFingerprint && !knownFingerprints.has(deviceFingerprint)) {
                score += 25; // New Device Fingerprint
            }

            return score;
        } catch (error) {
            console.error("Error checking device consistency:", error);
            return 0;
        }
    }

    static checkTimePatterns(activity, contextData) {
        const now = new Date();
        const hour = now.getHours();
        let score = 0;

        if (['place_order', 'driver_accept'].includes(activity)) {
            if (hour >= 0 && hour <= 5) { // 12 AM - 5 AM
                score += 20; // Late night activity
            } else if (hour >= 23 || hour <= 6) { // 11 PM - 6 AM
                score += 10;
            }
        }

        const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
        if (activity === 'vendor_management' && (dayOfWeek === 0 || dayOfWeek === 6)) {
            score += 10; // Admin activity on weekends
        }

        return score;
    }

    static async checkLocationAnomalies(userId, contextData) {
        // Mock: In a real scenario, this would compare current geo-location with historical ones.
        // E.g., if contextData.currentLocation is very far from last-known-location, and timeframe is small.
        // Requires a persistent storage of user's past locations.
        console.log(`MOCK: Checking location anomalies for user ${userId} with context`, contextData);
        return 0;
    }

    static async logFraudScore(userId, activity, score, factors) {
        await _firestore.collection('fraud_scores').add({
            userId,
            activity,
            score,
            factors,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            level: this.getScoreLevel(score)
        });
    }

    static getScoreLevel(score) {
        if (score >= this.fraudScoreThresholds.CRITICAL) return 'CRITICAL';
        if (score >= this.fraudScoreThresholds.HIGH) return 'HIGH';
        if (score >= this.fraudScoreThresholds.MEDIUM) return 'MEDIUM';
        if (score >= this.fraudScoreThresholds.LOW) return 'LOW';
        return 'CLEAN';
    }

    static async handleCriticalFraud(userId, activity, score, factors) {
        await _firestore.collection('users').doc(userId).update({
            suspended: true,
            suspendReason: `Auto-suspended due to critical fraud score: ${score}`,
            suspendedAt: _admin.firestore.FieldValue.serverTimestamp(),
            fraudFactors: factors
        });

        await SecurityLogger.logCriticalAction(userId, 'auto_suspended_fraud', {
            score,
            factors,
            activity
        });

        await _firestore.collection('admin_alerts').add({
            type: 'critical_fraud',
            severity: 'immediate',
            userId,
            activity,
            score,
            factors,
            timestamp: _admin.firestore.FieldValue.serverTimestamp(),
            autoAction: 'account_suspended'
        });
    }

    static async handleHighFraud(userId, activity, score, factors) {
        await _firestore.collection('users').doc(userId).update({
            flaggedForReview: true,
            flagReason: `High fraud score: ${score}`,
            flaggedAt: _admin.firestore.FieldValue.serverTimestamp(),
            fraudFactors: factors
        });

        await SecurityLogger.logCriticalAction(userId, 'flagged_for_review', {
            score,
            factors,
            activity
        });
    }
}

module.exports = AIFraudDetection;
