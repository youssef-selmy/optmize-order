// 028-error-handler-circuit-breaker.js (Original: CircuitBreakerErrorHandler.js)
const { _admin, _firestore, _functions } = require('./001-setup-initialization'); // Updated path
const PerformanceMonitor = require('./027-performance-monitor'); // Updated path
const SecurityLogger = require('./017-security-logger'); // Updated path
const AdvancedNotificationService = require('./022-multi-channel-notifications'); // For alerts (Updated path)

class CircuitBreakerErrorHandler {
    static circuitBreakers = new Map(); // Map<breakerKey, {state, failures, resetTime}>
    static errorPatterns = new Map(); // Map<breakerKey, [{message, timestamp, stack}, ...]>

    static async handleAsyncWithCircuitBreaker(operation, operationName, identifier = '', options = {}) {
        const {
            maxFailures = 5,
            resetTimeoutMs = 30000, // 30 seconds
            retryAttempts = 3,
            retryDelayMs = 1000
        } = options;

        const breakerKey = `${operationName}_${identifier}`;

        if (await this.isCircuitOpen(breakerKey)) {
            throw new Error(`Circuit breaker is OPEN for ${operationName}. Too many recent failures.`);
        }

        let lastError;

        for (let attempt = 1; attempt <= retryAttempts; attempt++) {
            try {
                const result = await PerformanceMonitor.trackFunction(operationName, operation);
                await this.recordSuccess(breakerKey);
                if (attempt > 1) {
                    console.log(`${operationName} succeeded on attempt ${attempt}`);
                }
                return result;
            } catch (error) {
                lastError = error;
                await this.recordFailure(breakerKey, error, maxFailures, resetTimeoutMs);
                if (attempt < retryAttempts) {
                    console.warn(`Attempt ${attempt}/${retryAttempts} failed for ${operationName}. Retrying in ${retryDelayMs * attempt}ms.`);
                    await this.delay(retryDelayMs * attempt);
                }
            }
        }

        await SecurityLogger.logCriticalAction('system', 'operation_failed_all_retries', { // Updated path
            operation: operationName,
            identifier,
            attempts: retryAttempts,
            finalError: lastError?.message,
            stack: lastError?.stack?.substring(0, 1000)
        });

        throw lastError;
    }

    static async isCircuitOpen(breakerKey) {
        const breaker = this.circuitBreakers.get(breakerKey);

        if (!breaker) {
            return false;
        }

        if (breaker.state === 'OPEN') {
            if (Date.now() > breaker.resetTime) {
                breaker.state = 'HALF_OPEN';
                console.log(`Circuit breaker for ${breakerKey} moved to HALF_OPEN`);
                return false;
            }
            return true;
        }

        return false;
    }

    static async recordSuccess(breakerKey) {
        const breaker = this.circuitBreakers.get(breakerKey);

        if (breaker) {
            if (breaker.state === 'HALF_OPEN') {
                breaker.state = 'CLOSED';
                breaker.failures = 0;
                breaker.resetTime = 0;
                console.log(`Circuit breaker for ${breakerKey} reset to CLOSED`);
            } else if (breaker.state === 'CLOSED') {
                breaker.failures = 0;
            }
        }
    }

    static async recordFailure(breakerKey, error, maxFailures, resetTimeoutMs) {
        if (!this.circuitBreakers.has(breakerKey)) {
            this.circuitBreakers.set(breakerKey, {
                state: 'CLOSED',
                failures: 0,
                resetTime: 0
            });
        }

        const breaker = this.circuitBreakers.get(breakerKey);

        // Only increment failures if not already OPEN
        if (breaker.state === 'CLOSED' || breaker.state === 'HALF_OPEN') {
            breaker.failures++;
            this.recordErrorPattern(breakerKey, error);

            if (breaker.failures >= maxFailures && breaker.state === 'CLOSED') { // Only open from CLOSED
                breaker.state = 'OPEN';
                breaker.resetTime = Date.now() + resetTimeoutMs;

                await SecurityLogger.logCriticalAction('system', 'circuit_breaker_opened', { // Updated path
                    breakerKey,
                    failures: breaker.failures,
                    maxFailures,
                    resetTime: new Date(breaker.resetTime).toISOString()
                });

                console.error(`Circuit breaker OPENED for ${breakerKey} after ${breaker.failures} failures. Resets at ${new Date(breaker.resetTime).toLocaleString()}`);
                await AdvancedNotificationService.sendMultiChannelNotification(
                    { role: 'admin', email: 'devops@example.com' }, // Mock recipient
                    { title: 'CRITICAL: Circuit Breaker Opened', body: `Circuit breaker '${breakerKey}' opened after ${breaker.failures} failures. Service may be degraded.` },
                    'critical', ['email', 'slack']
                ).catch(err => console.error("Failed to send circuit breaker alert notification:", err.message));
            } else if (breaker.state === 'HALF_OPEN') { // Revert to OPEN if failed in HALF_OPEN
                breaker.state = 'OPEN';
                breaker.resetTime = Date.now() + resetTimeoutMs;
                console.warn(`Circuit breaker for ${breakerKey} failed in HALF_OPEN state, reopening.`);
            }
        }
    }

    static recordErrorPattern(breakerKey, error) {
        if (!this.errorPatterns.has(breakerKey)) {
            this.errorPatterns.set(breakerKey, []);
        }

        const patterns = this.errorPatterns.get(breakerKey);
        patterns.push({
            message: error.message,
            timestamp: Date.now(),
            stack: error.stack?.substring(0, 500)
        });

        if (patterns.length > 50) {
            patterns.splice(0, patterns.length - 25);
        }
    }

    static async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static getCircuitBreakerStatus() {
        const status = {};

        for (const [key, breaker] of this.circuitBreakers) {
            status[key] = {
                state: breaker.state,
                failures: breaker.failures,
                resetTime: breaker.resetTime ? new Date(breaker.resetTime).toISOString() : null,
                recentErrors: this.errorPatterns.get(key)?.slice(-5) || []
            };
        }

        return status;
    }
}

module.exports = CircuitBreakerErrorHandler;