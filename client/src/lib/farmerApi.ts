/**
 * Farmer API - Direct Backend Integration
 * 
 * This module provides direct API calls to the backend for farmer operations.
 * It bypasses the local SQLite database and sends data directly to PostgreSQL.
 * 
 * Previously: Quick Add Farmer was saving to SQLite WASM (browser-side)
 * Now: Direct calls to backend tRPC endpoints → PostgreSQL
 */

import { trpc } from './trpc';

export interface FarmerInput {
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  village: string;
  district: string;
  region: string;
  nationalId?: string;
  photoUrl?: string | null;
}

export interface FarmInput {
  farmName: string;
  farmSize?: string | number;
  latitude: number;
  longitude: number;
}

export interface FarmerRegistrationInput extends FarmerInput {
  farm: FarmInput;
}

/**
 * Extract user ID from JWT token stored in localStorage
 * @returns User ID from the JWT payload
 * @throws Error if token is missing or invalid
 */
function getUserIdFromToken(): number {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    throw new Error('Not authenticated - no auth token found');
  }

  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // Decode payload (second part)
    const payload = JSON.parse(atob(parts[1]));
    
    if (!payload.userId) {
      throw new Error('JWT payload missing userId');
    }

    return payload.userId;
  } catch (error) {
    console.error('[FarmerAPI] Failed to decode token:', error);
    throw new Error('Failed to extract user ID from authentication token');
  }
}

/**
 * Register a new farmer and farm directly to backend
 * 
 * @param farmerData - Farmer information
 * @param farmData - Farm information  
 * @returns Created farmer object with ID
 * @throws Error if registration fails
 */
export async function registerFarmer(
  farmerData: FarmerInput,
  farmData: FarmInput
) {
  console.log('[FarmerAPI] Starting farmer registration with backend...');
  console.log('[FarmerAPI] Farmer data:', farmerData);
  console.log('[FarmerAPI] Farm data:', farmData);

  const userId = getUserIdFromToken();
  console.log('[FarmerAPI] User ID:', userId);

  try {
    // Call backend tRPC endpoint to create farmer
    // This sends data directly to PostgreSQL (not SQLite)
    const result = await trpc.farmers.create.mutate({
      userId,
      firstName: farmerData.firstName,
      lastName: farmerData.lastName,
      phoneNumber: farmerData.phoneNumber || null,
      email: farmerData.email || null,
      address: farmerData.address || null,
      village: farmerData.village,
      district: farmerData.district,
      region: farmerData.region,
      nationalId: farmerData.nationalId || null,
      photoUrl: farmerData.photoUrl || null,
    });

    console.log('[FarmerAPI] ✅ Farmer created on backend:', result);

    if (!result.id) {
      throw new Error('Farmer created but no ID was returned from backend');
    }

    // Now create the farm linked to this farmer
    const farmResult = await trpc.farms.create.mutate({
      userId,
      farmerId: result.id,
      farmName: farmData.farmName,
      farmSize: farmData.farmSize ? String(farmData.farmSize) : null,
      farmSizeUnit: 'acres',
      latitude: farmData.latitude,
      longitude: farmData.longitude,
      location: `${farmData.latitude}, ${farmData.longitude}`,
      soilType: null,
    });

    console.log('[FarmerAPI] ✅ Farm created on backend:', farmResult);

    return {
      farmer: result,
      farm: farmResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[FarmerAPI] ❌ Registration failed:', errorMessage);
    throw new Error(`Farmer registration failed: ${errorMessage}`);
  }
}

/**
 * Quick registration - single call with farmer and farm data
 * (Convenience wrapper)
 */
export async function quickRegisterFarmer(data: FarmerRegistrationInput) {
  return registerFarmer(
    {
      firstName: data.firstName,
      lastName: data.lastName,
      phoneNumber: data.phoneNumber,
      email: data.email,
      address: data.address,
      village: data.village,
      district: data.district,
      region: data.region,
      nationalId: data.nationalId,
      photoUrl: data.photoUrl,
    },
    {
      farmName: data.farm.farmName,
      farmSize: data.farm.farmSize,
      latitude: data.farm.latitude,
      longitude: data.farm.longitude,
    }
  );
}
