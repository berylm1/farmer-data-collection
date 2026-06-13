#!/usr/bin/env node
/**
 * Nightly CEO GitHub Code Review Agent
 * Farmer Data Collection Repository
 * 
 * Runs nightly on the Minisforum production worker to review:
 * - Tech debt
 * - Bugs
 * - Performance issues
 * - Business-role gaps
 * - Orphan/partial/scaffolded features
 * - Generic CRUD-only modules
 * - Incomplete end-to-end flows
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, relative, extname } from 'path';

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'tech-debt' | 'bug' | 'performance' | 'business-gap' | 'orphan-feature' | 'generic-crud' | 'incomplete-flow' | 'security' | 'architecture';
  file: string;
  line?: number;
  title: string;
  description: string;
  recommendation: string;
  evidence?: string;
}

interface AuditReport {
  timestamp: string;
  repository: string;
  commit: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  findings: Finding[];
}

class CEONightlyAgent {
  private repoPath: string;
  private findings: Finding[] = [];

  constructor(repoPath = '/home/beryl/farmer-data-collection') {
    this.repoPath = repoPath;
  }

  async run(): Promise<AuditReport> {
    console.log('[CEO Agent] Starting nightly code review...');
    
    const commit = this.getCurrentCommit();
    
    // Run all audit checks
    await this.checkCriticalConnectivityIssues();
    await this.checkSQLiteCorruption();
    await this.checkSyncMechanisms();
    await this.checkCSPAndConfig();
    await this.checkPerformanceAndBenchmarks();
    await this.checkTechDebt();
    await this.checkBusinessGaps();
    await this.checkOrphanFeatures();
    await this.checkIncompleteFlows();
    await this.checkSecurityIssues();
    await this.checkTests();
    await this.checkDocumentation();
    
    const report = this.generateReport(commit);
    this.saveReport(report);
    this.printSummary(report);
    
    return report;
  }

  private getCurrentCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { cwd: this.repoPath, encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private getChangedFiles(since?: string): string[] {
    try {
      const base = since || 'HEAD~1';
      const output = execSync(`git diff --name-only ${base}..HEAD`, { cwd: this.repoPath, encoding: 'utf-8' });
      return output.trim().split('\n').filter(f => f && !f.startsWith('.'));
    } catch {
      return [];
    }
  }

  // ============================================================================
  // CRITICAL ISSUE CHECKS (from GitHub Issues #1-5)
  // ============================================================================

  private async checkCriticalConnectivityIssues(): Promise<void> {
    const file = 'client/src/services/resilient-connectivity.ts';
    const content = this.readFile(file);
    
    if (!content) return;

    // Check for non-existent endpoints
    if (content.includes('/ws') && content.includes('wsUrl')) {
      this.addFinding({
        severity: 'critical',
        category: 'bug',
        file,
        title: 'ResilientConnectionManager uses non-existent /ws endpoint',
        description: 'Client defaults to /ws WebSocket endpoint but server only has Socket.IO at /socket.io/',
        recommendation: 'Change wsUrl default to /socket.io/ and use socket.io-client instead of raw WebSocket',
        evidence: 'Lines 290-292 in resilient-connectivity.ts'
      });
    }

    if (content.includes('/api/events')) {
      this.addFinding({
        severity: 'critical',
        category: 'bug',
        file,
        title: 'ResilientConnectionManager uses non-existent /api/events SSE endpoint',
        description: 'Server has no SSE endpoint at /api/events - will infinitely fallback',
        recommendation: 'Remove SSE fallback or implement SSE endpoint on server',
        evidence: 'Line 291 in resilient-connectivity.ts'
      });
    }

    if (content.includes('/api/poll')) {
      this.addFinding({
        severity: 'critical',
        category: 'bug',
        file,
        title: 'ResilientConnectionManager uses non-existent /api/poll polling endpoint',
        description: 'Server has no polling endpoint at /api/poll - JSON parse errors on every poll',
        recommendation: 'Remove polling fallback or implement polling endpoint',
        evidence: 'Line 292 in resilient-connectivity.ts'
      });
    }

    // Check if Socket.IO is used
    if (!content.includes('socket.io') && !content.includes('io(')) {
      this.addFinding({
        severity: 'critical',
        category: 'architecture',
        file,
        title: 'ResilientConnectionManager does not use Socket.IO despite server using it',
        description: 'Server uses Socket.IO at /socket.io/ but client uses raw WebSocket/SSE/polling',
        recommendation: 'Rewrite ResilientConnectionManager to use socket.io-client with proper transports',
        evidence: 'Server websocket-server.ts uses Socket.IO at path /socket.io/'
      });
    }
  }

  private async checkSQLiteCorruption(): Promise<void> {
    const file = 'client/src/db/sqliteWasmDb.ts';
    const content = this.readFile(file);
    
    if (!content) return;

    // Check for validation
    if (!content.includes('isValidSQLiteDatabase') && !content.includes('validateDatabaseIntegrity')) {
      this.addFinding({
        severity: 'critical',
        category: 'bug',
        file,
        title: 'Missing SQLite database corruption detection and validation',
        description: 'Corrupted OPFS/IndexedDB data silently falls back to in-memory without cleanup',
        recommendation: 'Add isValidSQLiteDatabase(), validateDatabaseIntegrity(), and clearAllPersistedData() methods',
        evidence: 'Lines 205-220: try/catch only checks "SELECT 1" but does not validate schema integrity'
      });
    }

    // Check for auto-cleanup on corruption
    if (!content.includes('clearAllPersistedData') && !content.includes('deleteDatabase')) {
      this.addFinding({
        severity: 'high',
        category: 'tech-debt',
        file,
        title: 'No automatic cleanup of corrupted database files',
        description: 'When corruption detected, corrupted data remains in OPFS/IndexedDB causing repeated failures',
        recommendation: 'Add automatic cleanup of OPFS file and IndexedDB backup on corruption detection',
        evidence: 'Line 215 sets existingData = null but does not delete persisted files'
      });
    }

    // Check for schema validation
    if (!content.includes('pragma integrity_check') && !content.includes('pragma quick_check')) {
      this.addFinding({
        severity: 'medium',
        category: 'performance',
        file,
        title: 'No SQLite integrity checks on database load',
        recommendation: 'Add PRAGMA integrity_check or PRAGMA quick_check after loading database',
        evidence: 'Only runs "SELECT 1" for validation'
      });
    }
  }

  private async checkSyncMechanisms(): Promise<void> {
    // Check for three sync systems
    const files = [
      'client/src/lib/syncManager.ts',
      'client/src/hooks/useSyncWithWebSocket.tsx',
      'client/src/hooks/useWebSocket.ts'
    ];

    let syncManagerExists = false;
    let useSyncWithWebSocketExists = false;
    let useWebSocketExists = false;

    for (const file of files) {
      if (this.readFile(file)) {
        if (file.includes('syncManager')) syncManagerExists = true;
        if (file.includes('useSyncWithWebSocket')) useSyncWithWebSocketExists = true;
        if (file.includes('useWebSocket') && !file.includes('useSyncWithWebSocket')) useWebSocketExists = true;
      }
    }

    if (syncManagerExists && useSyncWithWebSocketExists && useWebSocketExists) {
      this.addFinding({
        severity: 'critical',
        category: 'architecture',
        file: 'client/src/lib/syncManager.ts',
        title: 'Three uncoordinated sync mechanisms cause conflicts and duplicate work',
        description: 'SyncManager (tRPC HTTP), useSyncWithWebSocket (broken ResilientConnectionManager), and useWebSocket (Socket.IO) all handle sync independently',
        recommendation: 'Unify: 1) Delete useSyncWithWebSocket (deprecated), 2) Make SyncManager use Socket.IO for real-time + tRPC for batch, 3) Keep useWebSocket for UI notifications only',
        evidence: 'All three files exist and have overlapping responsibilities'
      });
    }

    // Check SyncManager for real-time integration
    const syncManagerContent = this.readFile('client/src/lib/syncManager.ts');
    if (syncManagerContent && !syncManagerContent.includes('socket.io') && !syncManagerContent.includes('WebSocket')) {
      this.addFinding({
        severity: 'high',
        category: 'architecture',
        file: 'client/src/lib/syncManager.ts',
        title: 'SyncManager lacks real-time event integration',
        description: 'SyncManager only uses tRPC HTTP polling, missing real-time updates via Socket.IO',
        recommendation: 'Add Socket.IO listener in SyncManager to trigger incremental sync on realtime_event',
        evidence: 'SyncManager only has startAutoSync() with setInterval, no event-driven sync'
      });
    }

    // Check for conflict resolution duplication
    if (syncManagerContent && syncManagerContent.includes('version') && syncManagerContent.includes('conflict')) {
      const useSyncContent = this.readFile('client/src/hooks/useSyncWithWebSocket.tsx');
      if (useSyncContent && useSyncContent.includes('conflict')) {
        this.addFinding({
          severity: 'high',
          category: 'tech-debt',
          file: 'client/src/hooks/useSyncWithWebSocket.tsx',
          title: 'Duplicate conflict resolution logic in multiple sync systems',
          recommendation: 'Centralize conflict resolution in SyncManager, remove from useSyncWithWebSocket',
          evidence: 'Both SyncManager and useSyncWithWebSocket handle version-based conflicts'
        });
      }
    }
  }

  private async checkCSPAndConfig(): Promise<void> {
    const serverIndex = this.readFile('server/index.ts');
    if (!serverIndex) return;

    // Check CSP for blob: worker
    if (serverIndex.includes('workerSrc')) {
      const cspMatch = serverIndex.match(/workerSrc:\s*\[([^\]]+)\]/);
      if (cspMatch && !cspMatch[1].includes('blob:')) {
        this.addFinding({
          severity: 'critical',
          category: 'security',
          file: 'server/index.ts',
          title: 'CSP missing blob: in worker-src directive',
          description: 'SQLite WASM worker fails to load because blob: URLs blocked by CSP',
          recommendation: 'Add "blob:" to workerSrc directive in helmet CSP config',
          evidence: 'Line 75: workerSrc directive - verify blob: is present'
        });
      }
    }

    // Check for getDb() proxy pattern
    const dbIndex = this.readFile('client/src/db/index.ts');
    if (dbIndex) {
      const getDbCalls = (dbIndex.match(/getDb\(\).then/g) || []).length;
      const searchFiles = await this.searchInFiles('getDb\\(\\)', ['client/src/**/*.ts', 'client/src/**/*.tsx']);
      if (searchFiles > 100) {
        this.addFinding({
          severity: 'high',
          category: 'performance',
          file: 'client/src/db/index.ts',
          title: 'Excessive getDb() calls due to Proxy pattern',
          description: `Found ${searchFiles} getDb() calls - each triggers async initialization check`,
          recommendation: 'Refactor to singleton pattern with single await at app startup, or use React context',
          evidence: 'db/index.ts lines 61-71 exports Proxy that throws, forcing await on every call'
        });
      }
    }
  }

  private async checkPerformanceAndBenchmarks(): Promise<void> {
    // Check for database indexes
    const schemaFiles = this.findFiles('drizzle', '.ts');
    let hasIndexes = false;
    for (const file of schemaFiles) {
      const content = this.readFile(file);
      if (content && content.includes('.index(') || content.includes('createIndex')) {
        hasIndexes = true;
        break;
      }
    }
    if (!hasIndexes) {
      this.addFinding({
        severity: 'high',
        category: 'performance',
        file: 'drizzle/schema.ts',
        title: 'No database indexes on frequently queried columns',
        description: 'Tables lack indexes on userId, updatedAt, clientId - full table scans on sync',
        recommendation: 'Add indexes: userId, updatedAt, clientId on all sync tables',
        evidence: 'No .index() calls found in drizzle schema files'
      });
    }

    // Check for benchmarks
    const loadTestFile = 'docs/LOAD_TESTING_BASELINE.md';
    const loadTestContent = this.readFile(loadTestFile);
    if (loadTestContent && !loadTestContent.includes('results') && !loadTestContent.includes('benchmark')) {
      this.addFinding({
        severity: 'medium',
        category: 'performance',
        file: loadTestFile,
        title: 'Load testing baseline exists but no results documented',
        description: 'LOAD_TESTING_BASELINE.md describes framework but has no actual benchmark results',
        recommendation: 'Run k6 load tests and document results: target 1000 concurrent users, sync throughput > 100 records/sec',
        evidence: 'File exists but appears to be template only'
      });
    }

    // Check bundle size analysis
    const packageJson = JSON.parse(this.readFile('package.json') || '{}');
    if (!packageJson.scripts?.analyze && !packageJson.scripts?.bundle) {
      this.addFinding({
        severity: 'medium',
        category: 'performance',
        file: 'package.json',
        title: 'No bundle size analysis script',
        recommendation: 'Add "analyze": "vite-bundle-analyzer" or "webpack-bundle-analyzer" to scripts',
        evidence: 'No bundle analysis in package.json scripts'
      });
    }
  }

  private async checkTechDebt(): Promise<void> {
    // Check for TODO/FIXME comments
    const tsFiles = this.findFiles('client/src', '.ts');
    tsFiles.push(...this.findFiles('client/src', '.tsx'));
    
    let todoCount = 0;
    let fixmeCount = 0;
    
    for (const file of tsFiles.slice(0, 50)) { // Sample first 50
      const content = this.readFile(file);
      if (content) {
        todoCount += (content.match(/TODO/gi) || []).length;
        fixmeCount += (content.match(/FIXME/gi) || []).length;
      }
    }

    if (todoCount > 20 || fixmeCount > 10) {
      this.addFinding({
        severity: 'medium',
        category: 'tech-debt',
        file: 'client/src/**/*.ts',
        title: `High technical debt: ${todoCount} TODOs and ${fixmeCount} FIXMEs found`,
        description: 'Many unimplemented/needs-review markers indicate incomplete work',
        recommendation: 'Create GitHub issues for each TODO/FIXME, prioritize and assign',
        evidence: `Sampled 50 files: ${todoCount} TODOs, ${fixmeCount} FIXMEs`
      });
    }

    // Check for console.warn/error in production code
    for (const file of tsFiles.slice(0, 30)) {
      const content = this.readFile(file);
      if (content) {
        const warns = (content.match(/console\.warn/gi) || []).length;
        const errors = (content.match(/console\.error/gi) || []).length;
        if (warns > 5 || errors > 3) {
          this.addFinding({
            severity: 'low',
            category: 'tech-debt',
            file,
            title: 'Excessive console.warn/error in production code',
            description: `${warns} console.warn, ${errors} console.error calls`,
            recommendation: 'Replace with proper logging library (pino, winston) with log levels',
            evidence: 'Counted in file'
          });
          break; // Report once
        }
      }
    }

    // Check for any usage
    const anyRegex = /:\s*any\b/g;
    let anyCount = 0;
    for (const file of tsFiles.slice(0, 30)) {
      const content = this.readFile(file);
      if (content) {
        anyCount += (content.match(anyRegex) || []).length;
      }
    }
    if (anyCount > 50) {
      this.addFinding({
        severity: 'medium',
        category: 'tech-debt',
        file: 'client/src/**/*.ts',
        title: `Excessive use of 'any' type: ${anyCount} occurrences`,
        description: 'Type safety compromised, potential runtime errors',
        recommendation: 'Enable strict: true in tsconfig, replace any with proper types',
        evidence: 'Sampled 30 files'
      });
    }
  }

  private async checkBusinessGaps(): Promise<void> {
    // Check for missing business logic in sync
    const syncManager = this.readFile('client/src/lib/syncManager.ts');
    if (syncManager) {
      // Check for offline-first business logic
      if (!syncManager.includes('offline') && !syncManager.includes('Offline')) {
        this.addFinding({
          severity: 'high',
          category: 'business-gap',
          file: 'client/src/lib/syncManager.ts',
          title: 'SyncManager lacks offline-first business logic',
          description: 'No handling for offline data entry, conflict resolution for offline edits, or sync-on-reconnect priority',
          recommendation: 'Add offline queue with priority sync, conflict resolution for offline vs server changes',
          evidence: 'SyncManager only works when online, no offline support mentioned'
        });
      }

      // Check for business role support
      if (!syncManager.includes('role') && !syncManager.includes('permission')) {
        this.addFinding({
          severity: 'medium',
          category: 'business-gap',
          file: 'client/src/lib/syncManager.ts',
          title: 'No role-based sync permissions',
          description: 'All users sync all tables regardless of role (farmer, agent, admin, cooperative)',
          recommendation: 'Add role-based table access control in sync operations',
          evidence: 'SyncManager syncs all 7 tables for every user'
        });
      }
    }

    // Check for data validation
    const validationFile = 'shared/schemas/validation.ts';
    const validation = this.readFile(validationFile);
    if (validation && !validation.includes('zod')) {
      this.addFinding({
        severity: 'medium',
        category: 'business-gap',
        file: validationFile,
        title: 'Shared validation schemas may not use Zod',
        description: 'Server uses Zod but client validation may be inconsistent',
        recommendation: 'Ensure shared Zod schemas used on both client and server',
        evidence: 'Check if validation.ts exports Zod schemas'
      });
    }
  }

  private async checkOrphanFeatures(): Promise<void> {
    // Check for unused files in client/src
    const allFiles = this.findFiles('client/src', '.ts');
    allFiles.push(...this.findFiles('client/src', '.tsx'));
    
    // Check for exports that are never imported
    const exportFiles: { file: string; exports: string[] }[] = [];
    
    for (const file of allFiles) {
      const content = this.readFile(file);
      if (content) {
        const exports = content.match(/export\s+(?:const|function|class|interface|type)\s+(\w+)/g) || [];
        if (exports.length > 0) {
          exportFiles.push({ file, exports: exports.map(e => e.split(/\s+/).pop() || '') });
        }
      }
    }

    // Check for potentially orphaned pages/components
    const pagesDir = 'client/src/pages';
    if (existsSync(join(this.repoPath, pagesDir))) {
      const pageFiles = readdirSync(join(this.repoPath, pagesDir))
        .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
        .map(f => join(pagesDir, f));
      
      for (const page of pageFiles) {
        const content = this.readFile(page);
        if (content && !content.includes('export default') && !content.includes('export const')) {
          this.addFinding({
            severity: 'low',
            category: 'orphan-feature',
            file: page,
            title: 'Page component may not be exported/used',
            description: 'Page file exists but may not be routed or exported',
            recommendation: 'Verify page is in router config, delete if unused',
            evidence: 'No export default or export const found'
          });
        }
      }
    }

    // Check for scripts that may be dead
    const scriptsDir = 'scripts';
    if (existsSync(join(this.repoPath, scriptsDir))) {
      const scriptFiles = readdirSync(join(this.repoPath, scriptsDir))
        .filter(f => f.endsWith('.ts') || f.endsWith('.mjs'))
        .map(f => join(scriptsDir, f));
      
      // Look for test/seed only scripts
      for (const script of scriptFiles) {
        const content = this.readFile(script);
        if (content && (content.includes('seed') || content.includes('test')) && !content.includes('export')) {
          this.addFinding({
            severity: 'low',
            category: 'orphan-feature',
            file: script,
            title: 'Script appears to be one-time seed/test only',
            description: 'May be dead code after initial setup',
            recommendation: 'Delete if no longer needed, or move to tests/fixtures',
            evidence: 'Contains seed/test keywords, no exports'
          });
        }
      }
    }
  }

  private async checkIncompleteFlows(): Promise<void> {
    // Check for incomplete E2E flows
    const e2eTests = this.findFiles('tests/e2e', '.ts');
    e2eTests.push(...this.findFiles('tests/mobile/e2e', '.ts'));
    
    if (e2eTests.length < 5) {
      this.addFinding({
        severity: 'high',
        category: 'incomplete-flow',
        file: 'tests/e2e/',
        title: 'Insufficient E2E test coverage for critical user flows',
        description: `Only ${e2eTests.length} E2E test files found`,
        recommendation: 'Add E2E tests for: farmer registration → farm creation → crop planting → harvest → expense logging → sync',
        evidence: 'Critical paths spec exists but may not cover full flows'
      });
    }

    // Check for sync → UI update flow
    const useSyncPath = 'client/src/hooks/useSyncWithWebSocket.tsx';
    const useSync = this.readFile(useSyncPath);
    if (useSync && !useSync.includes('queryClient.invalidateQueries')) {
      this.addFinding({
        severity: 'high',
        category: 'incomplete-flow',
        file: useSyncPath,
        title: 'Sync completion does not invalidate React Query cache',
        description: 'After sync, UI may show stale data until manual refresh',
        recommendation: 'Add queryClient.invalidateQueries for synced tables in triggerSync',
        evidence: 'Check triggerSync function for cache invalidation'
      });
    }

    // Check for authentication flow completeness
    const authRouter = this.readFile('server/auth-router.ts');
    if (authRouter) {
      if (!authRouter.includes('refresh') && !authRouter.includes('Refresh')) {
        this.addFinding({
          severity: 'medium',
          category: 'incomplete-flow',
          file: 'server/auth-router.ts',
          title: 'Missing token refresh flow',
          description: 'No refresh token endpoint - users will be logged out when access token expires',
          recommendation: 'Add /refresh endpoint with refresh token rotation',
          evidence: 'Auth router lacks refresh token logic'
        });
      }
    }

    // Check for error boundaries in React
    const appContent = this.readFile('client/src/App.tsx');
    if (appContent && !appContent.includes('ErrorBoundary') && !appContent.includes('error-boundary')) {
      this.addFinding({
        severity: 'medium',
        category: 'incomplete-flow',
        file: 'client/src/App.tsx',
        title: 'No React Error Boundary for graceful error handling',
        description: 'Uncaught React errors will crash entire app instead of showing fallback UI',
        recommendation: 'Add ErrorBoundary component wrapping routes/pages',
        evidence: 'App.tsx does not import or use ErrorBoundary'
      });
    }
  }

  private async checkSecurityIssues(): Promise<void> {
    // Check for hardcoded secrets
    const allFiles = this.findFiles('.', '.ts');
    allFiles.push(...this.findFiles('.', '.tsx'));
    allFiles.push(...this.findFiles('.', '.js'));
    allFiles.push(...this.findFiles('.', '.mjs'));
    
    for (const file of allFiles.slice(0, 100)) {
      const content = this.readFile(file);
      if (content && (content.includes('sk_live_') || content.includes('pk_live_') || content.includes('secret_key') || content.includes('api_key') || content.includes('password')) && !file.includes('.env') && !file.includes('test')) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('sk_live_') || lines[i].includes('pk_live_') || lines[i].includes('secret_key') || lines[i].includes('api_key')) {
            this.addFinding({
              severity: 'critical',
              category: 'security',
              file,
              line: i + 1,
              title: 'Possible hardcoded secret/API key',
              description: 'Potential credential exposure in source code',
              recommendation: 'Move to environment variables, rotate compromised keys',
              evidence: `Line ${i + 1}: ${lines[i].trim().substring(0, 80)}`
            });
            break;
          }
        }
      }
    }

    // Check for in-memory stores in production code
    const syncRouter = this.readFile('server/sync-router.ts');
    if (syncRouter && syncRouter.includes('idempotencyStore') && syncRouter.includes('new Map()')) {
      this.addFinding({
        severity: 'high',
        category: 'security',
        file: 'server/sync-router.ts',
        title: 'In-memory idempotency store (not distributed)',
        description: 'Idempotency keys stored in Map - will not work with multiple server replicas',
        recommendation: 'Use Redis for distributed idempotency store',
        evidence: 'Lines 36, 94: const idempotencyStore = new Map()'
      });
    }

    // Check for CSP unsafe-inline/eval in production
    const serverIndex = this.readFile('server/index.ts');
    if (serverIndex) {
      if (serverIndex.includes("'unsafe-inline'") && serverIndex.includes('isProduction')) {
        const prodCheck = serverIndex.match(/isProduction\s*\?\s*\[([^\]]+)\]/);
        if (prodCheck && prodCheck[1].includes("'unsafe-inline'")) {
          this.addFinding({
            severity: 'high',
            category: 'security',
            file: 'server/index.ts',
            title: 'CSP allows unsafe-inline in production',
            description: 'Script/style sources include unsafe-inline even in production mode',
            recommendation: 'Remove unsafe-inline from production CSP, use nonces or hashes',
            evidence: 'Helmet config scriptSrc for production includes unsafe-inline'
          });
        }
      }
    }

    // Check for rate limiting on WebSocket
    if (!serverIndex?.includes('rateLimit') || !serverIndex.includes('websocket')) {
      this.addFinding({
        severity: 'medium',
        category: 'security',
        file: 'server/index.ts',
        title: 'No rate limiting on WebSocket connections',
        description: 'WebSocket endpoints lack rate limiting - vulnerable to connection exhaustion',
        recommendation: 'Add Socket.IO rate limiting middleware or connection limits per IP',
        evidence: 'No rateLimiters.websocket found in server/index.ts'
      });
    }
  }

  private async checkTests(): Promise<void> {
    const testFiles = this.findFiles('tests', '.ts');
    const testCount = testFiles.length;
    
    if (testCount < 20) {
      this.addFinding({
        severity: 'medium',
        category: 'tech-debt',
        file: 'tests/',
        title: `Low test coverage: only ${testCount} test files`,
        description: 'Insufficient test coverage for critical paths',
        recommendation: 'Aim for >80% coverage on sync, auth, payment, and data integrity logic',
        evidence: `Found ${testCount} test files in tests/`
      });
    }

    // Check for integration tests
    const integrationTests = testFiles.filter(f => f.includes('integration') || f.includes('e2e')).length;
    if (integrationTests < 5) {
      this.addFinding({
        severity: 'medium',
        category: 'incomplete-flow',
        file: 'tests/',
        title: 'Insufficient integration/E2E tests',
        description: `Only ${integrationTests} integration/E2E test files`,
        recommendation: 'Add integration tests for sync flows, auth flows, payment flows',
        evidence: 'Integration test files count'
      });
    }
  }

  private async checkDocumentation(): Promise<void> {
    const docFiles = [
      'APPLICATION_OVERVIEW.md',
      'PRODUCTION_DEPLOYMENT.md',
      'OPERATIONAL_RUNBOOK.md',
      'SECURITY_TESTING.md',
      'docs/OPERATIONAL_RUNBOOK.md',
      'docs/LOAD_TESTING_BASELINE.md',
      'docs/SLI_SLO_DEFINITIONS.md',
      'docs/DISASTER_RECOVERY.md'
    ];

    for (const doc of docFiles) {
      const content = this.readFile(doc);
      if (!content) {
        this.addFinding({
          severity: 'medium',
          category: 'tech-debt',
          file: doc,
          title: 'Missing documentation file',
          description: `Expected documentation file not found: ${doc}`,
          recommendation: 'Create missing documentation or update references',
          evidence: 'File does not exist'
        });
      } else if (content.length < 500) {
        this.addFinding({
          severity: 'low',
          category: 'tech-debt',
          file: doc,
          title: 'Documentation file appears incomplete',
          description: `${doc} has only ${content.length} characters`,
          recommendation: 'Expand documentation with actual procedures, not just templates',
          evidence: 'File size very small'
        });
      }
    }

    // Check for API documentation
    if (!existsSync(join(this.repoPath, 'docs/API_DOCUMENTATION.md'))) {
      this.addFinding({
        severity: 'medium',
        category: 'tech-debt',
        file: 'docs/API_DOCUMENTATION.md',
        title: 'Missing API documentation',
        description: 'No consolidated API documentation for tRPC endpoints',
        recommendation: 'Generate from tRPC router or create OpenAPI spec documentation',
        evidence: 'File not found'
      });
    }
  }

  private async searchInFiles(pattern: string, globs: string[]): Promise<number> {
    try {
      let total = 0;
      for (const glob of globs) {
        const cmd = `grep -r "${pattern}" --include="${glob}" ${this.repoPath} 2>/dev/null | wc -l`;
        const output = execSync(cmd, { cwd: this.repoPath, encoding: 'utf-8', shell: true });
        total += parseInt(output.trim()) || 0;
      }
      return total;
    } catch {
      return 0;
    }
  }

  private findFiles(dir: string, ext: string): string[] {
    const results: string[] = [];
    const fullDir = join(this.repoPath, dir);
    
    function walk(d: string) {
      try {
        const entries = readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(ext)) {
            results.push(relative(this.repoPath, fullPath));
          }
        }
      } catch {
        // Ignore errors
      }
    }
    
    walk(fullDir);
    return results;
  }

  private readFile(file: string): string {
    try {
      return readFileSync(join(this.repoPath, file), 'utf-8');
    } catch {
      return '';
    }
  }

  private addFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  private generateReport(commit: string): AuditReport {
    const summary = {
      critical: this.findings.filter(f => f.severity === 'critical').length,
      high: this.findings.filter(f => f.severity === 'high').length,
      medium: this.findings.filter(f => f.severity === 'medium').length,
      low: this.findings.filter(f => f.severity === 'low').length,
      total: this.findings.length
    };

    return {
      timestamp: new Date().toISOString(),
      repository: 'farmer-data-collection',
      commit,
      summary,
      findings: this.findings
    };
  }

  private saveReport(report: AuditReport): void {
    const reportDir = join(this.repoPath, 'reports', 'ceo-agent');
    
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }

    const filename = `ceo-audit-${report.timestamp.split('T')[0]}-${report.commit.substring(0, 8)}.json`;
    const filepath = join(reportDir, filename);
    
    writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`[CEO Agent] Report saved to ${filepath}`);
  }

  private printSummary(report: AuditReport): void {
    console.log('\n═══════════════════════════════════════════');
    console.log('CEO NIGHTLY CODE REVIEW SUMMARY');
    console.log('═══════════════════════════════════════════');
    console.log(`Repository: ${report.repository}`);
    console.log(`Commit: ${report.commit}`);
    console.log(`Timestamp: ${report.timestamp}`);
    console.log('\nFindings by Severity:');
    console.log(`  🔴 Critical: ${report.summary.critical}`);
    console.log(`  🟠 High:     ${report.summary.high}`);
    console.log(`  🟡 Medium:   ${report.summary.medium}`);
    console.log(`  🟢 Low:      ${report.summary.low}`);
    console.log(`  ────────────────`);
    console.log(`  Total:       ${report.summary.total}`);
    console.log('\nTop Critical Issues:');
    
    const critical = report.findings.filter(f => f.severity === 'critical');
    for (const f of critical.slice(0, 5)) {
      console.log(`  [${f.category}] ${f.file}`);
      console.log(`    ${f.title}`);
    }
    
    if (critical.length > 5) {
      console.log(`  ... and ${critical.length - 5} more critical issues`);
    }
  }
}

// Run if executed directly (tsx handles this)
const agent = new CEONightlyAgent();
agent.run().catch(console.error);

export { CEONightlyAgent, AuditReport, Finding };