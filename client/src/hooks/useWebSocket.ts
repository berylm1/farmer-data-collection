/**
 * WebSocket Hook for Real-time Updates
 * 
 * NOW USES: useResilientConnection (Socket.IO-based) instead of duplicate socket.io-client
 * This eliminates multiple Socket.IO connections.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  useResilientConnection,
  type ConnectionStatus,
  type NetworkQuality,
} from '@/services/resilient-connectivity';

// ============================================================================
// Types
// ============================================================================

export interface RealtimeEvent {
  type: 'farmer_created' | 'farmer_updated' | 'farm_created' | 'farm_updated' | 
        'crop_planted' | 'livestock_added' | 'harvest_recorded' | 'expense_logged' |
        'dashboard_update' | 'notification';
  userId: number;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface WebSocketStatus {
  connected: boolean;
  socketId?: string;
  transport?: string;
  networkQuality?: NetworkQuality;
  queueSize?: number;
  reconnectAttempts?: number;
}

// ============================================================================
// WebSocket Hook (with Resilient Connectivity - NO DUPLICATE Socket.IO)
// ============================================================================

export function useWebSocket() {
  const { user } = useAuth();
  const [status, setStatus] = useState<WebSocketStatus>({ connected: false });
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  // Use ResilientConnectionManager (Socket.IO) for everything - NO duplicate io() call
  const clientId = user ? `user-${user.id}-${Date.now()}` : undefined;
  const { status: resilientStatus, send: resilientSend, subscribe: resilientSubscribe } =
    useResilientConnection(clientId);

  // Map resilient status to WebSocket status
  useEffect(() => {
    setStatus(prev => ({
      ...prev,
      connected: resilientStatus.state === 'connected',
      transport: resilientStatus.transport,
      networkQuality: resilientStatus.network.quality,
      queueSize: resilientStatus.queueSize,
      reconnectAttempts: resilientStatus.reconnectAttempts,
    }));
  }, [resilientStatus]);

  // Subscribe to resilient connection messages and forward as events
  useEffect(() => {
    const unsub = resilientSubscribe('realtime_event', (data) => {
      const event = data as RealtimeEvent;
      setLastEvent(event);
      handleEventNotification(event);
    });
    return unsub;
  }, [resilientSubscribe]);

  // Subscribe to sync events
  useEffect(() => {
    const unsub = resilientSubscribe('sync_event', (data) => {
      const event = data as RealtimeEvent;
      setLastEvent(event);
      handleEventNotification(event);
    });
    return unsub;
  }, [resilientSubscribe]);

  const handleEventNotification = (event: RealtimeEvent) => {
    switch (event.type) {
      case 'farmer_created':
        toast.success('New Farmer Registered', {
          description: `${event.data.name} has been added to your records`,
        });
        break;
      case 'harvest_recorded':
        toast.success('Harvest Recorded', {
          description: `${event.data.quantity} kg of ${event.data.cropType} harvested`,
        });
        break;
      case 'expense_logged':
        toast.info('Expense Logged', {
          description: `${event.data.category}: $${event.data.amount}`,
        });
        break;
      case 'notification': {
        const notif = event.data as { type?: string; title?: string; message?: string };
        const toastType = notif.type === 'alert' ? toast.warning : 
                         notif.type === 'error' ? toast.error : toast.info;
        toastType(notif.title || 'Notification', {
          description: notif.message,
        });
        break;
      }
    }
  };

  const subscribe = useCallback((channel: string) => {
    // Use resilientSend for subscribing
    resilientSend('subscribe', { channel }, 'high');
  }, [resilientSend]);

  const unsubscribe = useCallback((channel: string) => {
    resilientSend('unsubscribe', { channel }, 'high');
  }, [resilientSend]);

  const sendQueued = useCallback(
    (channel: string, payload: unknown, priority?: 'high' | 'normal' | 'low') => {
      return resilientSend(channel, payload, priority);
    },
    [resilientSend],
  );

  return {
    status,
    lastEvent,
    subscribe,
    unsubscribe,
    sendQueued,
    networkQuality: resilientStatus.network.quality,
    isOffline: resilientStatus.state === 'offline',
    pendingMessages: resilientStatus.queueSize,
  };
}

// ============================================================================
// Event-specific Hooks
// ============================================================================

export function useRealtimeEvent(
  eventType: RealtimeEvent['type'],
  callback: (data: Record<string, unknown>) => void
) {
  const { lastEvent } = useWebSocket();

  useEffect(() => {
    if (lastEvent && lastEvent.type === eventType) {
      callback(lastEvent.data);
    }
  }, [lastEvent, eventType, callback]);
}

export function useDashboardUpdates(onUpdate: (update: Record<string, unknown>) => void) {
  useRealtimeEvent('dashboard_update', onUpdate);
}

export function useFarmerEvents(onFarmerEvent: (farmer: Record<string, unknown>) => void) {
  const { lastEvent } = useWebSocket();

  useEffect(() => {
    if (lastEvent && (lastEvent.type === 'farmer_created' || lastEvent.type === 'farmer_updated')) {
      onFarmerEvent(lastEvent.data);
    }
  }, [lastEvent, onFarmerEvent]);
}

export function useHarvestEvents(onHarvestEvent: (harvest: Record<string, unknown>) => void) {
  useRealtimeEvent('harvest_recorded', onHarvestEvent);
}

export function useExpenseEvents(onExpenseEvent: (expense: Record<string, unknown>) => void) {
  useRealtimeEvent('expense_logged', onExpenseEvent);
}