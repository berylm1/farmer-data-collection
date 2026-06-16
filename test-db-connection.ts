// Quick test to validate database connection
import { getDb, checkDbHealth } from './server/db.ts';

async function testDatabaseConnection() {
  try {
    console.log('Testing database connection...');
    const db = await getDb();
    console.log('Database connection successful!');
    
    const health = await checkDbHealth();
    console.log('Database health:', health);
    
    // Test a simple query
    const result = await db.select({ count: 1 }).from('users');
    console.log('Basic query successful:', result);
    
  } catch (error) {
    console.error('Database test failed:', error);
  }
}

testDatabaseConnection().catch(console.error);