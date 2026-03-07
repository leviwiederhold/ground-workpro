// @ts-nocheck
'use client';
/* eslint-disable @next/next/no-img-element, react/no-unescaped-entities, @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StatGrid } from '@/app/components/ui/StatGrid';
import { EmptyState, InlineError, LoadingBlock } from '@/app/components/ui/FeedbackBlocks';

const DashboardView = dynamic(
  () => import('@/app/components/views/DashboardView').then((mod) => mod.DashboardView)
);
const BidsView = dynamic(
  () => import('@/app/components/views/BidsView').then((mod) => mod.BidsView)
);
const DocumentsView = dynamic(
  () => import('@/app/components/views/DocumentsView').then((mod) => mod.DocumentsView)
);
const MessagesView = dynamic(
  () => import('@/app/components/views/MessagesView').then((mod) => mod.MessagesView)
);
const ScheduleView = dynamic(
  () => import('@/app/components/views/ScheduleView').then((mod) => mod.ScheduleView)
);
const JobsView = dynamic(
  () => import('@/app/components/views/JobsView').then((mod) => mod.JobsView)
);

const confirmDestructiveAction = (targetLabel) =>
  window.confirm(`Delete ${targetLabel}? This cannot be undone.`);


    // ============================================
    // MOCK DATA - Would come from API in production
    // ============================================

    const JOBS = [
      { id: 1, name: 'Highway 71 Widening', client: 'ODOT', status: 'active', address: '4521 Highway 71, Columbus, OH', budget: 2850000, spent: 1847500, startDate: '2025-11-01', endDate: '2026-04-15', progress: 65, lat: 39.9612, lng: -82.9988 },
      { id: 2, name: 'Riverside Development', client: 'Kaufman Development', status: 'active', address: '892 River Rd, Cincinnati, OH', budget: 1200000, spent: 485000, startDate: '2025-12-15', endDate: '2026-06-30', progress: 35, lat: 39.1031, lng: -84.5120 },
      { id: 3, name: 'Downtown Parking Garage', client: 'City of Dayton', status: 'active', address: '100 Main St, Dayton, OH', budget: 890000, spent: 267000, startDate: '2026-01-10', endDate: '2026-05-20', progress: 25, lat: 39.7589, lng: -84.1916 },
      { id: 4, name: 'Maple Ridge Subdivision', client: 'DR Horton', status: 'bidding', address: '2000 Maple Dr, Dublin, OH', budget: 1500000, spent: 0, startDate: '2026-03-01', endDate: '2026-09-30', progress: 0, lat: 40.0992, lng: -83.1141 },
      { id: 5, name: 'Industrial Park Phase 2', client: 'Prologis', status: 'completed', address: '500 Commerce Blvd, Grove City, OH', budget: 675000, spent: 628000, startDate: '2025-06-01', endDate: '2025-12-20', progress: 100, lat: 39.8812, lng: -83.0930 },
    ];

    const EQUIPMENT = [
      { id: 1, name: 'CAT 336 Excavator', type: 'Excavator', status: 'active', jobId: 1, hours: 4521, nextService: 4750, fuelLevel: 72, lat: 39.9615, lng: -82.9985, lastUpdate: '2 min ago', dailyRate: 850, owned: true, purchasePrice: 385000, purchaseDate: '2022-03-15' },
      { id: 2, name: 'CAT D6 Dozer', type: 'Dozer', status: 'active', jobId: 1, hours: 3892, nextService: 4000, fuelLevel: 45, lat: 39.9610, lng: -82.9990, lastUpdate: '5 min ago', dailyRate: 750, owned: true, purchasePrice: 320000, purchaseDate: '2021-08-20' },
      { id: 3, name: 'Volvo A40G', type: 'Haul Truck', status: 'active', jobId: 2, hours: 2156, nextService: 2250, fuelLevel: 89, lat: 39.1035, lng: -84.5125, lastUpdate: '1 min ago', dailyRate: 650, owned: true, purchasePrice: 425000, purchaseDate: '2023-01-10' },
      { id: 4, name: 'CAT 14M Grader', type: 'Grader', status: 'maintenance', jobId: null, hours: 5678, nextService: 5750, fuelLevel: 30, lat: 39.9500, lng: -83.0500, lastUpdate: '1 hr ago', dailyRate: 600, owned: true, purchasePrice: 295000, purchaseDate: '2020-05-22' },
      { id: 5, name: 'Komatsu PC210', type: 'Excavator', status: 'active', jobId: 3, hours: 1823, nextService: 2000, fuelLevel: 61, lat: 39.7592, lng: -84.1920, lastUpdate: '3 min ago', dailyRate: 700, owned: true, purchasePrice: 275000, purchaseDate: '2024-02-28' },
      { id: 6, name: 'John Deere 310L', type: 'Backhoe', status: 'idle', jobId: null, hours: 892, nextService: 1000, fuelLevel: 95, lat: 39.9500, lng: -83.0500, lastUpdate: '2 days ago', dailyRate: 400, owned: true, purchasePrice: 125000, purchaseDate: '2024-06-15' },
      { id: 7, name: 'CAT 950M Loader', type: 'Loader', status: 'active', jobId: 2, hours: 3421, nextService: 3500, fuelLevel: 55, lat: 39.1028, lng: -84.5118, lastUpdate: '8 min ago', dailyRate: 550, owned: true, purchasePrice: 265000, purchaseDate: '2022-11-30' },
      { id: 8, name: 'Bomag BW211', type: 'Compactor', status: 'active', jobId: 1, hours: 1567, nextService: 1750, fuelLevel: 78, lat: 39.9608, lng: -82.9992, lastUpdate: '4 min ago', dailyRate: 450, owned: true, purchasePrice: 185000, purchaseDate: '2023-07-12' },
    ];

    const EMPLOYEES = [
      { id: 1, name: 'Mike Johnson', role: 'Foreman', phone: '(614) 555-0101', email: 'mjohnson@groundwork.com', hourlyRate: 42, certifications: [{ name: 'OSHA 30', expires: '2026-08-15' }, { name: 'CDL Class A', expires: '2026-03-22' }], jobId: 1, status: 'clocked-in', clockedInAt: '06:45 AM' },
      { id: 2, name: 'Sarah Williams', role: 'Equipment Operator', phone: '(614) 555-0102', email: 'swilliams@groundwork.com', hourlyRate: 35, certifications: [{ name: 'OSHA 10', expires: '2025-12-01' }, { name: 'CDL Class B', expires: '2027-01-15' }], jobId: 1, status: 'clocked-in', clockedInAt: '07:00 AM' },
      { id: 3, name: 'James Rodriguez', role: 'Equipment Operator', phone: '(614) 555-0103', email: 'jrodriguez@groundwork.com', hourlyRate: 35, certifications: [{ name: 'OSHA 10', expires: '2026-05-20' }, { name: 'Excavator Cert', expires: '2026-11-30' }], jobId: 2, status: 'clocked-in', clockedInAt: '06:30 AM' },
      { id: 4, name: 'David Chen', role: 'Foreman', phone: '(614) 555-0104', email: 'dchen@groundwork.com', hourlyRate: 42, certifications: [{ name: 'OSHA 30', expires: '2026-02-28' }, { name: 'CDL Class A', expires: '2025-09-10' }], jobId: 2, status: 'clocked-in', clockedInAt: '06:45 AM' },
      { id: 5, name: 'Tom Martinez', role: 'Laborer', phone: '(614) 555-0105', email: 'tmartinez@groundwork.com', hourlyRate: 26, certifications: [{ name: 'OSHA 10', expires: '2026-07-12' }], jobId: 1, status: 'clocked-in', clockedInAt: '07:15 AM' },
      { id: 6, name: 'Chris Taylor', role: 'Equipment Operator', phone: '(614) 555-0106', email: 'ctaylor@groundwork.com', hourlyRate: 35, certifications: [{ name: 'OSHA 10', expires: '2026-04-18' }, { name: 'CDL Class A', expires: '2026-12-05' }], jobId: 3, status: 'clocked-in', clockedInAt: '07:00 AM' },
      { id: 7, name: 'Brian Wilson', role: 'Mechanic', phone: '(614) 555-0107', email: 'bwilson@groundwork.com', hourlyRate: 38, certifications: [{ name: 'ASE Master', expires: '2027-03-01' }, { name: 'CAT Certified', expires: '2026-06-30' }], jobId: null, status: 'clocked-in', clockedInAt: '07:30 AM' },
      { id: 8, name: 'Kevin Brown', role: 'Laborer', phone: '(614) 555-0108', email: 'kbrown@groundwork.com', hourlyRate: 26, certifications: [{ name: 'OSHA 10', expires: '2026-09-25' }], jobId: null, status: 'off', clockedInAt: null },
    ];

    const WORK_ORDERS = [
      { id: 1, equipmentId: 4, type: 'repair', priority: 'high', status: 'in-progress', title: 'Hydraulic Leak - Main Cylinder', description: 'Significant hydraulic fluid leak from main lift cylinder. Needs seal replacement.', assignedTo: 7, createdAt: '2026-02-02', dueDate: '2026-02-05', parts: [{ name: 'Cylinder Seal Kit', partNo: 'CAT-14M-SEAL-01', qty: 1, cost: 485 }], laborHours: 6 },
      { id: 2, equipmentId: 2, type: 'preventive', priority: 'medium', status: 'scheduled', title: '4000 Hour Service', description: 'Scheduled preventive maintenance at 4000 hours. Oil change, filters, inspection.', assignedTo: 7, createdAt: '2026-02-01', dueDate: '2026-02-08', parts: [{ name: 'Oil Filter', partNo: 'CAT-D6-OIL-01', qty: 2, cost: 45 }, { name: 'Fuel Filter', partNo: 'CAT-D6-FUEL-01', qty: 2, cost: 62 }, { name: 'Engine Oil 15W-40', partNo: 'OIL-15W40-5GAL', qty: 3, cost: 89 }], laborHours: 4 },
      { id: 3, equipmentId: 5, type: 'inspection', priority: 'low', status: 'scheduled', title: 'Annual DOT Inspection', description: 'Required annual inspection for road compliance.', assignedTo: 7, createdAt: '2026-02-03', dueDate: '2026-02-15', parts: [], laborHours: 2 },
    ];

    const DAILY_REPORTS = [
      { id: 1, jobId: 1, date: '2026-02-03', submittedBy: 1, weather: 'Partly Cloudy', tempHigh: 42, tempLow: 28, crewSize: 6, workAccomplished: 'Completed 450 LF of storm sewer installation. Set 3 manholes. Backfilled and compacted 200 LF.', materialsUsed: [{ item: 'Storm Pipe 24"', qty: 450, unit: 'LF' }, { item: 'Crusite Stone', qty: 85, unit: 'TN' }], issues: 'Minor delay due to unmarked utilities. Called 811 for re-mark.', tomorrowPlan: 'Continue storm sewer east toward Main St intersection.' },
      { id: 2, jobId: 2, date: '2026-02-03', submittedBy: 4, weather: 'Sunny', tempHigh: 45, tempLow: 30, crewSize: 4, workAccomplished: 'Mass excavation of building pad area. Removed approximately 2,400 CY of material. Hauled to approved disposal site.', materialsUsed: [{ item: 'Excavated Material', qty: 2400, unit: 'CY' }], issues: 'None', tomorrowPlan: 'Complete building pad excavation. Begin proof rolling.' },
    ];

    const COST_CODES = [
      { code: '01-100', description: 'Mobilization', budgeted: 45000 },
      { code: '02-100', description: 'Clearing & Grubbing', budgeted: 28000 },
      { code: '02-200', description: 'Mass Excavation', budgeted: 185000 },
      { code: '02-300', description: 'Structural Excavation', budgeted: 92000 },
      { code: '02-400', description: 'Backfill & Compaction', budgeted: 124000 },
      { code: '03-100', description: 'Storm Sewer', budgeted: 340000 },
      { code: '03-200', description: 'Sanitary Sewer', budgeted: 280000 },
      { code: '03-300', description: 'Water Main', budgeted: 195000 },
      { code: '04-100', description: 'Aggregate Base', budgeted: 156000 },
      { code: '04-200', description: 'Asphalt Paving', budgeted: 420000 },
    ];

    // INVENTORY DATA
    const INVENTORY = [
      { id: 1, name: '24" HDPE Storm Pipe', category: 'Pipe', unit: 'LF', qtyOnHand: 850, qtyReserved: 450, reorderPoint: 200, unitCost: 42, jobId: 1, location: 'Yard A' },
      { id: 2, name: '18" RCP Storm Pipe', category: 'Pipe', unit: 'LF', qtyOnHand: 320, qtyReserved: 0, reorderPoint: 100, unitCost: 38, jobId: null, location: 'Yard A' },
      { id: 3, name: '#57 Crushed Stone', category: 'Aggregate', unit: 'TN', qtyOnHand: 245, qtyReserved: 85, reorderPoint: 100, unitCost: 28, jobId: 1, location: 'Yard B' },
      { id: 4, name: '#304 Limestone', category: 'Aggregate', unit: 'TN', qtyOnHand: 180, qtyReserved: 50, reorderPoint: 75, unitCost: 32, jobId: 2, location: 'Yard B' },
      { id: 5, name: '4" PVC SDR35', category: 'Pipe', unit: 'LF', qtyOnHand: 1200, qtyReserved: 400, reorderPoint: 300, unitCost: 8, jobId: 1, location: 'Yard A' },
      { id: 6, name: 'Manhole Ring & Cover', category: 'Structures', unit: 'EA', qtyOnHand: 12, qtyReserved: 3, reorderPoint: 5, unitCost: 485, jobId: 1, location: 'Yard A' },
      { id: 7, name: '48" Manhole Base', category: 'Structures', unit: 'EA', qtyOnHand: 8, qtyReserved: 3, reorderPoint: 3, unitCost: 1250, jobId: 1, location: 'Yard A' },
      { id: 8, name: 'Geotextile Fabric', category: 'Materials', unit: 'SY', qtyOnHand: 2500, qtyReserved: 800, reorderPoint: 500, unitCost: 2.5, jobId: null, location: 'Yard C' },
      { id: 9, name: 'Silt Fence', category: 'Erosion Control', unit: 'LF', qtyOnHand: 1800, qtyReserved: 500, reorderPoint: 400, unitCost: 3, jobId: 2, location: 'Yard C' },
      { id: 10, name: 'Orange Safety Fence', category: 'Safety', unit: 'LF', qtyOnHand: 600, qtyReserved: 200, reorderPoint: 200, unitCost: 0.5, jobId: null, location: 'Yard C' },
    ];

    // SAFETY TRAINING DATA
    const SAFETY_TRAINING = [
      { id: 1, title: 'Excavation & Trenching Safety', category: 'OSHA Required', duration: '45 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300', required: true, dueDate: '2026-03-01', completedBy: [1, 2, 3, 5] },
      { id: 2, title: 'Fall Protection Fundamentals', category: 'OSHA Required', duration: '30 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=300', required: true, dueDate: '2026-03-01', completedBy: [1, 4, 6] },
      { id: 3, title: 'Heavy Equipment Blind Spots', category: 'Equipment', duration: '20 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300', required: true, dueDate: '2026-02-15', completedBy: [2, 3, 6] },
      { id: 4, title: 'Silica Dust Exposure Prevention', category: 'Health', duration: '25 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300', required: true, dueDate: '2026-04-01', completedBy: [1, 2, 3, 4, 5, 6] },
      { id: 5, title: 'Lockout/Tagout Procedures', category: 'OSHA Required', duration: '35 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=300', required: true, dueDate: '2026-03-15', completedBy: [] },
      { id: 6, title: 'Spotter Signals & Communication', category: 'Equipment', duration: '15 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300', required: false, dueDate: null, completedBy: [2, 3, 6] },
      { id: 7, title: 'Heat Illness Prevention', category: 'Health', duration: '20 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300', required: false, dueDate: null, completedBy: [1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 8, title: 'Underground Utility Awareness', category: 'Site Safety', duration: '30 min', videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', thumbnail: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300', required: true, dueDate: '2026-02-28', completedBy: [1, 4] },
    ];

    // VENDORS DATA
    const VENDORS = [
      { id: 1, name: 'Martin Marietta Materials', category: 'Aggregates', contact: 'Bob Stevens', phone: '(513) 555-0201', email: 'bstevens@martinmarietta.com', rating: 5, activeOrders: 2 },
      { id: 2, name: 'Ferguson Waterworks', category: 'Pipe & Fittings', contact: 'Lisa Chen', phone: '(513) 555-0202', email: 'lchen@ferguson.com', rating: 4, activeOrders: 1 },
      { id: 3, name: 'United Rentals', category: 'Equipment Rental', contact: 'Mike Thompson', phone: '(513) 555-0203', email: 'mthompson@ur.com', rating: 4, activeOrders: 0 },
      { id: 4, name: 'Sunbelt Rentals', category: 'Equipment Rental', contact: 'Sarah Davis', phone: '(513) 555-0204', email: 'sdavis@sunbelt.com', rating: 5, activeOrders: 1 },
      { id: 5, name: 'Forterra Pipe', category: 'Concrete Products', contact: 'Tom Wilson', phone: '(513) 555-0205', email: 'twilson@forterra.com', rating: 5, activeOrders: 3 },
      { id: 6, name: 'CAT - Ohio Machinery', category: 'Parts & Service', contact: 'Jim Brown', phone: '(513) 555-0206', email: 'jbrown@ohiomachinery.com', rating: 5, activeOrders: 1 },
    ];

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
    const formatDate = (dateStr) => {
      if (!dateStr) return 'TBD';
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
        ? `${dateStr}T00:00:00Z`
        : String(dateStr);
      const parsedDate = new Date(normalized);
      if (Number.isNaN(parsedDate.getTime())) return 'TBD';
      return parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    };
    const formatTime = (date) => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const getYouTubeVideoId = (inputUrl) => {
      const value = String(inputUrl || '').trim();
      if (!value) return null;
      try {
        const url = new URL(value);
        if (url.hostname.includes('youtube.com')) {
          if (url.pathname === '/watch') return url.searchParams.get('v');
          if (url.pathname.startsWith('/embed/')) return url.pathname.replace('/embed/', '').split('/')[0] || null;
          if (url.pathname.startsWith('/shorts/')) return url.pathname.replace('/shorts/', '').split('/')[0] || null;
        }
        if (url.hostname === 'youtu.be') return url.pathname.replace('/', '').split('/')[0] || null;
      } catch {
        return null;
      }
      return null;
    };
    const deriveYouTubeThumbnail = (videoUrl, fallback = '') => {
      if (String(fallback || '').trim()) return fallback.trim();
      const videoId = getYouTubeVideoId(videoUrl);
      return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '';
    };
    const toYouTubeEmbedUrl = (videoUrl) => {
      const value = String(videoUrl || '').trim();
      if (!value) return '';
      const videoId = getYouTubeVideoId(value);
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      return value;
    };
    const getUtcDateLabel = (date = new Date()) =>
      date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const getDaysUntil = (dateStr) => {
      if (!dateStr) return 0;
      const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
        ? `${dateStr}T00:00:00Z`
        : String(dateStr);
      const target = new Date(normalized);
      if (Number.isNaN(target.getTime())) return 0;
      const now = new Date();
      const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
      return Math.ceil((targetUtc - startOfTodayUtc) / (1000 * 60 * 60 * 24));
    };

    const getStatusColor = (status) => {
      const colors = {
        'active': 'bg-green-100 text-green-800',
        'preferred': 'bg-blue-100 text-blue-800',
        'on_hold': 'bg-yellow-100 text-yellow-800',
        'assigned': 'bg-green-100 text-green-800',
        'ASSIGNED': 'bg-green-100 text-green-800',
        'idle': 'bg-yellow-100 text-yellow-800',
        'IDLE': 'bg-yellow-100 text-yellow-800',
        'maintenance': 'bg-red-100 text-red-800',
        'in_maintenance': 'bg-blue-100 text-blue-800',
        'IN_MAINTENANCE': 'bg-blue-100 text-blue-800',
        'out_of_service': 'bg-red-100 text-red-800',
        'OUT_OF_SERVICE': 'bg-red-100 text-red-800',
        'completed': 'bg-blue-100 text-blue-800',
        'bidding': 'bg-purple-100 text-purple-800',
        'clocked-in': 'bg-green-100 text-green-800',
        'off': 'bg-gray-100 text-gray-600',
        'in-progress': 'bg-blue-100 text-blue-800',
        'scheduled': 'bg-yellow-100 text-yellow-800',
        'pending': 'bg-orange-100 text-orange-800',
      };
      return colors[status] || 'bg-gray-100 text-gray-800';
    };

    const getPriorityColor = (priority) => {
      const colors = { high: 'text-red-600', medium: 'text-yellow-600', low: 'text-green-600' };
      return colors[priority] || 'text-gray-600';
    };

    const CONTACT_CIRCLE_COLORS = ['bg-brand-500', 'bg-green-500', 'bg-blue-500', 'bg-red-500'];
    const getContactCircleColor = (seedValue) => {
      const seed = String(seedValue || '');
      if (!seed) return CONTACT_CIRCLE_COLORS[0];
      let hash = 0;
      for (let index = 0; index < seed.length; index += 1) {
        hash = (hash << 5) - hash + seed.charCodeAt(index);
        hash |= 0;
      }
      return CONTACT_CIRCLE_COLORS[Math.abs(hash) % CONTACT_CIRCLE_COLORS.length];
    };

    // ============================================
    // ICON COMPONENT
    // ============================================

    const Icon = ({ name, className = '' }) => (
      <i className={`fa-solid fa-${name} ${className}`}></i>
    );

    // ============================================
    // SHARED COMPONENTS
    // ============================================

    const Card = ({ children, className = '', onClick, ...props }) => (
      <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`} onClick={onClick} {...props}>
        {children}
      </div>
    );

    const Button = ({ children, variant = 'primary', size = 'md', onClick, disabled, className = '', ...props }) => {
      const variants = {
        primary: 'bg-dark-900 hover:bg-dark-800 text-white',
        secondary: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300',
        brand: 'bg-brand-500 hover:bg-brand-600 text-white',
        danger: 'bg-red-600 hover:bg-red-700 text-white',
        ghost: 'hover:bg-gray-100 text-gray-600',
      };
      const sizes = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-sm',
        lg: 'px-6 py-3 text-base',
      };
      return (
        <button
          className={`${variants[variant]} ${sizes[size]} rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mobile-tap-target ${className}`}
          onClick={onClick}
          disabled={disabled}
          {...props}
        >
          {children}
        </button>
      );
    };

    const Badge = ({ children, variant = 'default', className = '' }) => {
      const variants = {
        default: 'bg-gray-100 text-gray-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-yellow-100 text-yellow-800',
        danger: 'bg-red-100 text-red-800',
        info: 'bg-blue-100 text-blue-800',
      };
      return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
          {children}
        </span>
      );
    };

    const ProgressBar = ({ value, max = 100, color = 'brand', size = 'md', showLabel = false }) => {
      const percentage = Math.min((value / max) * 100, 100);
      const colors = {
        brand: 'bg-brand-500',
        green: 'bg-green-500',
        yellow: 'bg-yellow-500',
        red: 'bg-red-500',
        blue: 'bg-blue-500',
      };
      const sizes = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' };
      const autoColor = percentage > 90 ? 'red' : percentage > 75 ? 'yellow' : 'green';
      const barColor = color === 'auto' ? autoColor : color;

      return (
        <div className="w-full">
          <div className={`w-full bg-gray-200 rounded-full ${sizes[size]}`}>
            <div className={`${colors[barColor]} ${sizes[size]} rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
          </div>
          {showLabel && <span className="text-xs text-gray-500 mt-1">{Math.round(percentage)}%</span>}
        </div>
      );
    };

    const Modal = ({ isOpen, onClose, title, children, size = 'md' }) => {
      if (!isOpen) return null;
      const sizes = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[95vw]' };
      return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/50" onClick={onClose}></div>
          <div className="flex min-h-full items-end md:items-center justify-center p-0 md:p-4">
            <div className={`relative bg-white rounded-t-xl md:rounded-xl shadow-2xl ${sizes[size]} w-full max-h-[92vh] md:max-h-[90vh] overflow-hidden`}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Icon name="xmark" className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-[calc(90vh-80px)] p-4">
                {children}
              </div>
            </div>
          </div>
        </div>
      );
    };

    const Tabs = ({ tabs, activeTab, onChange }) => (
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.icon && <Icon name={tab.icon} className="mr-2" />}
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${activeTab === tab.id ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-600'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    );

    const SearchInput = ({ value, onChange, placeholder = 'Search...' }) => (
      <div className="relative">
        <Icon name="magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
      </div>
    );

    const StatCard = ({ icon, label, value, subValue, trend, color = 'brand', onClick, href, testId }) => {
      const iconBg = {
        brand: 'bg-brand-100 text-brand-600',
        green: 'bg-green-100 text-green-600',
        red: 'bg-red-100 text-red-600',
        blue: 'bg-blue-100 text-blue-600',
        yellow: 'bg-yellow-100 text-yellow-600',
      };
      const isInteractive = typeof onClick === 'function' || Boolean(href);
      const handleCardClick = () => {
        if (typeof onClick === 'function') {
          onClick();
        }
      };
      return (
        <Card
          className={`p-3 sm:p-4 ${isInteractive ? 'cursor-pointer' : ''}`}
          onClick={isInteractive ? handleCardClick : undefined}
          data-testid={testId}
        >
          <div className="flex items-start justify-between">
            <div className={`p-2 rounded-lg ${iconBg[color]}`}>
              <Icon name={icon} className="text-lg" />
            </div>
            {trend && (
              <span className={`text-xs font-medium ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                <Icon name={trend > 0 ? 'arrow-up' : 'arrow-down'} className="mr-1" />
                {Math.abs(trend)}%
              </span>
            )}
          </div>
          <div className="mt-3">
            <p className="text-xl sm:text-2xl font-dozer text-gray-900">{value}</p>
            <p className="text-sm text-gray-500 font-medium leading-tight">{label}</p>
            {subValue && <p className="text-xs text-gray-400 mt-1">{subValue}</p>}
          </div>
        </Card>
      );
    };

    const Table = ({ columns, data, onRowClick }) => (
      <div className="overflow-x-auto">
        <table className="w-full responsive-table">
          <thead>
            <tr className="border-b border-gray-200">
              {columns.map((col, i) => (
                <th key={i} className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick && onRowClick(row)}
              >
                {columns.map((col, colIndex) => (
                  <td key={colIndex} className={`px-4 py-3 text-sm ${col.cellClassName || ''}`}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    const AttachmentPanel = ({ entityType, entityId }) => {
      const [attachments, setAttachments] = useState([]);
      const [loading, setLoading] = useState(false);
      const [uploading, setUploading] = useState(false);
      const [error, setError] = useState('');
      const fileInputRef = useRef(null);
      const isDocumentContext = ['job', 'vendor', 'document'].includes(String(entityType || '').toLowerCase());
      const panelLabel = isDocumentContext ? 'Documents' : 'Attachments';
      const emptyLabel = isDocumentContext ? 'No documents yet.' : 'No attachments yet.';

      const loadAttachments = useCallback(async () => {
        if (entityId === null || entityId === undefined || entityId === '') {
          setAttachments([]);
          return;
        }
        setLoading(true);
        setError('');
        try {
          const response = await fetch(`/api/attachments?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(String(entityId))}`, { cache: 'no-store' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok) {
            setError(payload?.error || raw || 'Failed to load attachments');
            setLoading(false);
            return;
          }
          setAttachments(payload?.attachments || []);
        } catch {
          setError('Failed to load attachments');
        } finally {
          setLoading(false);
        }
      }, [entityType, entityId]);

      useEffect(() => {
        loadAttachments();
      }, [loadAttachments]);

      const handleUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || entityId === null || entityId === undefined || entityId === '') return;

        setUploading(true);
        setError('');
        try {
          const formData = new FormData();
          formData.append('entity_type', entityType);
          formData.append('entity_id', String(entityId));
          formData.append('file', file);

          const response = await fetch('/api/attachments/upload', {
            method: 'POST',
            body: formData,
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.attachment) {
            setError(payload?.error || raw || 'Failed to upload file');
            setUploading(false);
            return;
          }

          await loadAttachments();
        } catch {
          setError('Failed to upload file');
        } finally {
          setUploading(false);
        }
      };

      const handleDelete = async (attachmentId) => {
        const confirmed = confirmDestructiveAction(isDocumentContext ? 'this document' : 'this attachment');
        if (!confirmed) return;
        setError('');
        try {
          const response = await fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setError(payload?.error || raw || 'Failed to delete attachment');
            return;
          }
          setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
        } catch {
          setError('Failed to delete attachment');
        }
      };

      return (
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">{panelLabel}</p>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Icon name="paperclip" className="mr-1" />
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading attachments...</p>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-gray-400">{emptyLabel}</p>
          ) : (
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="p-2 bg-gray-50 rounded-lg flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{attachment.fileName}</p>
                    <p className="text-xs text-gray-500">{attachment.contentType || 'file'}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(attachment.download_url || attachment.signedDownloadUrl) ? (
                      <a
                        href={attachment.download_url || attachment.signedDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-2 py-1 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 border border-gray-200">No link</span>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(attachment.id)}>
                      <Icon name="trash" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
      );
    };

    // ============================================
    // MAIN APPLICATION
    // ============================================

    // Role definitions with permissions
    const ROLES = {
      executive: { label: 'Executive / CEO', icon: 'crown', color: 'text-yellow-500' },
      operations: { label: 'Operations Manager', icon: 'sitemap', color: 'text-blue-500' },
      foreman: { label: 'Foreman', icon: 'helmet-safety', color: 'text-orange-500' },
      mechanic: { label: 'Mechanic', icon: 'wrench', color: 'text-red-500' },
      operator: { label: 'Operator', icon: 'user-gear', color: 'text-green-500' },
      field: { label: 'Field Staff', icon: 'user-gear', color: 'text-green-500' },
    };

    const App = ({ currentUser, onLogout }) => {
      const [currentView, setCurrentView] = useState(() => {
        if (typeof window === 'undefined') return 'dashboard';
        return window.localStorage.getItem('app.currentView') || 'dashboard';
      });
      const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
      const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
      const [selectedJob, setSelectedJob] = useState(null);
      const [showModal, setShowModal] = useState({ type: null, data: null });
      const [currentRole, setCurrentRole] = useState('executive');
      const [canSwitchRoleView, setCanSwitchRoleView] = useState(false);
      const [showRoleSelector, setShowRoleSelector] = useState(false);
      const [actingRoleSaving, setActingRoleSaving] = useState(false);
      const [serverNavItems, setServerNavItems] = useState([]);
      const [navLoaded, setNavLoaded] = useState(false);
      const [showNotifications, setShowNotifications] = useState(false);
      const [showUserMenu, setShowUserMenu] = useState(false);
      const [notifications, setNotifications] = useState([]);
      const [notificationsLoading, setNotificationsLoading] = useState(false);
      const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
      const [notificationFilter, setNotificationFilter] = useState('all');
      const [headerDateLabel, setHeaderDateLabel] = useState('');

      // Data State
      const [jobs, setJobs] = useState([]);
      const [jobsLoading, setJobsLoading] = useState(true);
      const [equipment, setEquipment] = useState([]);
      const [equipmentLoading, setEquipmentLoading] = useState(true);
      const [employees, setEmployees] = useState([]);
      const [employeesLoading, setEmployeesLoading] = useState(true);
      const [workOrders, setWorkOrders] = useState([]);
      const [workOrdersLoading, setWorkOrdersLoading] = useState(true);
      const [dailyReports, setDailyReports] = useState([]);
      const [dailyReportsLoading, setDailyReportsLoading] = useState(true);
      const [timeEntries, setTimeEntries] = useState([]);
      const [scheduleData, setScheduleData] = useState({});
      const [calendarRefreshVersion, setCalendarRefreshVersion] = useState(0);

      // Additional State
      const [inventory, setInventory] = useState([]);
      const [inventoryLoading, setInventoryLoading] = useState(true);
      const [bids, setBids] = useState([]);
      const [bidsLoading, setBidsLoading] = useState(true);
      const [vendors, setVendors] = useState([]);
      const [vendorsLoading, setVendorsLoading] = useState(true);
      const [costCodes, setCostCodes] = useState([]);
      const [costCodesLoading, setCostCodesLoading] = useState(true);
      const [safetyLogs, setSafetyLogs] = useState([]);
      const [safetyLogsLoading, setSafetyLogsLoading] = useState(true);
      const [safetyLogsError, setSafetyLogsError] = useState('');
      const [safetyCreateLoading, setSafetyCreateLoading] = useState(false);
      const [safetyDeleteLoadingId, setSafetyDeleteLoadingId] = useState(null);
      const [trainingData, setTrainingData] = useState(SAFETY_TRAINING);
      const [trainingLoading, setTrainingLoading] = useState(true);
      const [trainingError, setTrainingError] = useState('');
      const moduleLoadedRef = useRef({
        jobs: false,
        costCodes: false,
        bids: false,
        vendors: false,
        inventory: false,
        employees: false,
        dailyReports: false,
        workOrders: false,
        equipment: false,
        safety: false,
        training: false,
      });

      const mapServerRoleToUiRole = useCallback((role) => {
        if (role === 'admin') return 'executive';
        if (role === 'pm') return 'operations';
        if (role === 'foreman') return 'foreman';
        if (role === 'mechanic') return 'mechanic';
        if (role === 'operator') return 'operator';
        return 'executive';
      }, []);

      const mapUiRoleToServerRole = useCallback((role) => {
        if (role === 'executive') return 'admin';
        if (role === 'operations') return 'pm';
        if (role === 'foreman') return 'foreman';
        if (role === 'mechanic') return 'mechanic';
        if (role === 'operator' || role === 'field') return 'operator';
        return 'admin';
      }, []);

      const fallbackNavByRole = useCallback((role) => {
        const navLibrary = {
          dashboard: { key: 'dashboard', label: 'Dashboard', iconKey: 'table-cells-large' },
          schedule: { key: 'schedule', label: 'Schedule', iconKey: 'calendar-week' },
          jobs: { key: 'jobs', label: 'Jobs', iconKey: 'briefcase' },
          team: { key: 'team', label: 'Team', iconKey: 'people-group' },
          fleet: { key: 'fleet', label: 'Fleet', iconKey: 'truck-field' },
          messages: { key: 'messages', label: 'Messages', iconKey: 'comments' },
          maintenance: { key: 'maintenance', label: 'Maintenance', iconKey: 'toolbox' },
          inventory: { key: 'inventory', label: 'Inventory', iconKey: 'warehouse' },
          safety: { key: 'safety', label: 'Safety', iconKey: 'shield-heart' },
          reports: { key: 'reports', label: 'Reports', iconKey: 'chart-line' },
          bids: { key: 'bids', label: 'Bids', iconKey: 'file-contract' },
          vendors: { key: 'vendors', label: 'Vendors', iconKey: 'handshake' },
          documents: { key: 'documents', label: 'Documents', iconKey: 'folder-open' },
          training: { key: 'training', label: 'Training', iconKey: 'chalkboard-user' },
          finance: { key: 'finance', label: 'Finance', iconKey: 'landmark' },
          integrations: { key: 'integrations', label: 'Integrations', iconKey: 'plug' },
          settings: { key: 'settings', label: 'Settings', iconKey: 'gear' },
          subscribe: { key: 'subscribe', label: 'Subscribe', iconKey: 'credit-card' },
          audit: { key: 'audit', label: 'Audit', iconKey: 'clipboard-list' },
        };
        const byRole = {
          executive: ['dashboard', 'jobs', 'bids', 'vendors', 'inventory', 'fleet', 'maintenance', 'safety', 'messages', 'finance', 'reports', 'integrations', 'settings', 'subscribe', 'audit', 'documents', 'team', 'training', 'schedule'],
          operations: ['dashboard', 'jobs', 'bids', 'vendors', 'inventory', 'fleet', 'safety', 'messages', 'reports', 'finance', 'settings', 'documents', 'team', 'training', 'schedule'],
          foreman: ['dashboard', 'messages', 'schedule', 'jobs', 'reports', 'safety'],
          mechanic: ['dashboard', 'messages', 'fleet', 'maintenance', 'inventory', 'safety'],
          operator: ['dashboard', 'messages', 'schedule', 'safety'],
        };
        return (byRole[String(role || 'executive')] || byRole.executive).map((key) => navLibrary[key]).filter(Boolean);
      }, []);

      const loadNav = useCallback(async () => {
        try {
          const response = await fetch('/api/nav', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setServerNavItems(fallbackNavByRole(currentRole));
            return;
          }
          const uiRole = mapServerRoleToUiRole(payload?.role);
          setCurrentRole(uiRole);
          setCanSwitchRoleView(Boolean(payload?.canSwitchRoleView));
          const resolvedItems = Array.isArray(payload?.items) && payload.items.length > 0 ? payload.items : fallbackNavByRole(uiRole);
          setServerNavItems(resolvedItems);
        } catch {
          setServerNavItems(fallbackNavByRole(currentRole));
        } finally {
          setNavLoaded(true);
        }
      }, [currentRole, fallbackNavByRole, mapServerRoleToUiRole]);

      const notificationVisuals = {
        assignment_created: {
          icon: 'calendar-plus',
          containerClass: 'bg-blue-100',
          iconClass: 'text-blue-700',
        },
        assignment_removed: {
          icon: 'calendar-xmark',
          containerClass: 'bg-yellow-100',
          iconClass: 'text-yellow-700',
        },
        event_invited: {
          icon: 'calendar-check',
          containerClass: 'bg-green-100',
          iconClass: 'text-green-700',
        },
        event_updated: {
          icon: 'calendar-days',
          containerClass: 'bg-indigo-100',
          iconClass: 'text-indigo-700',
        },
        event_canceled: {
          icon: 'calendar-xmark',
          containerClass: 'bg-red-100',
          iconClass: 'text-red-700',
        },
        safety_log_created: {
          icon: 'shield-halved',
          containerClass: 'bg-emerald-100',
          iconClass: 'text-emerald-700',
        },
        work_order_reported: {
          icon: 'screwdriver-wrench',
          containerClass: 'bg-orange-100',
          iconClass: 'text-orange-700',
        },
        default: {
          icon: 'bell',
          containerClass: 'bg-gray-100',
          iconClass: 'text-gray-600',
        },
      };

      const formatNotificationTime = (value) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      };

      const loadNotifications = useCallback(async () => {
        try {
          setNotificationsLoading(true);
          const [listResponse, countResponse] = await Promise.all([
            fetch('/api/activity/feed?limit=30', { cache: 'no-store' }),
            fetch('/api/notifications/unread-count', { cache: 'no-store' }),
          ]);
          const payload = await listResponse.json();
          const countPayload = await countResponse.json().catch(() => ({}));
          if (!listResponse.ok) throw new Error(payload?.error || 'Failed to load notifications');
          setNotifications(payload.items || []);
          if (countResponse.ok) {
            setUnreadNotificationsCount(Number(countPayload?.item?.count ?? 0));
          } else {
            setUnreadNotificationsCount((payload.items || []).filter((item) => item.source === 'notification' && !item.is_read).length);
          }
        } catch {
          setNotifications([]);
          setUnreadNotificationsCount(0);
        } finally {
          setNotificationsLoading(false);
        }
      }, []);

      const loadSafetyLogs = useCallback(async () => {
        try {
          setSafetyLogsLoading(true);
          setSafetyLogsError('');
          const response = await fetch('/api/safety-logs', { cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || 'Failed to load safety logs');
          setSafetyLogs(payload.items || []);
        } catch (error) {
          setSafetyLogs([]);
          setSafetyLogsError(error instanceof Error ? error.message : 'Failed to load safety logs');
        } finally {
          setSafetyLogsLoading(false);
        }
      }, []);

      const mapTrainingCourseFromApi = useCallback((course) => ({
        id: course.id,
        title: course.title,
        category: course.category || 'General',
        duration: `${Number(course.durationMinutes || 0)} min`,
        videoUrl: toYouTubeEmbedUrl(course.videoUrl || 'https://www.youtube.com/embed/dQw4w9WgXcQ'),
        thumbnail:
          deriveYouTubeThumbnail(course.videoUrl || '', course.thumbnailUrl || '') ||
          'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=300',
        required: Boolean(course.required),
        dueDate: course.dueDate || null,
        completedBy: (course.completedEmployeeIds || []).map((value) => String(value)),
        assignedEmployeeIds: (course.assignedEmployeeIds || []).map((value) => String(value)),
      }), []);

      const loadTraining = useCallback(async () => {
        try {
          setTrainingLoading(true);
          setTrainingError('');
          const response = await fetch('/api/training/courses', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || 'Failed to load training courses');
          }
          setTrainingData((payload.items || []).map(mapTrainingCourseFromApi));
        } catch (error) {
          setTrainingError(error instanceof Error ? error.message : 'Failed to load training courses');
          setTrainingData([]);
        } finally {
          setTrainingLoading(false);
        }
      }, [mapTrainingCourseFromApi]);

      const handleCreateSafetyLog = useCallback(async (input) => {
        try {
          setSafetyCreateLoading(true);
          const response = await fetch('/api/safety-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          });
          const payload = await response.json();
          if (!response.ok || !payload?.item) {
            return { ok: false, error: payload?.error || 'Failed to create safety log' };
          }
          setSafetyLogs((prev) => [payload.item, ...prev]);
          return { ok: true, item: payload.item };
        } catch {
          return { ok: false, error: 'Failed to create safety log' };
        } finally {
          setSafetyCreateLoading(false);
        }
      }, []);

      const handleDeleteSafetyLog = useCallback(async (id) => {
        const confirmed = confirmDestructiveAction('this safety log');
        if (!confirmed) return { ok: false, error: 'Cancelled' };

        try {
          setSafetyDeleteLoadingId(id);
          const response = await fetch(`/api/safety-logs/${id}`, { method: 'DELETE' });
          const payload = await response.json();
          if (!response.ok) {
            return { ok: false, error: payload?.error || 'Failed to delete safety log' };
          }
          setSafetyLogs((prev) => prev.filter((item) => String(item.id) !== String(id)));
          return { ok: true };
        } catch {
          return { ok: false, error: 'Failed to delete safety log' };
        } finally {
          setSafetyDeleteLoadingId(null);
        }
      }, []);

      const handleMarkNotificationRead = async (notificationId) => {
        const notification = notifications.find((item) => String(item.id) === String(notificationId));
        if (!notification || notification.source !== 'notification') return;
        const rawId = String(notification.id).startsWith('n:') ? String(notification.id).slice(2) : String(notification.id);
        try {
          const response = await fetch(`/api/notifications/${rawId}/read`, { method: 'POST' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return;
          setNotifications((prev) =>
            prev.map((item) =>
              String(item.id) === String(notificationId)
                ? { ...item, is_read: true, read_at: payload?.item?.readAt ?? item.read_at }
                : item
            )
          );
          const countResponse = await fetch('/api/notifications/unread-count', { cache: 'no-store' });
          if (countResponse.ok) {
            const countPayload = await countResponse.json().catch(() => ({}));
            setUnreadNotificationsCount(Number(countPayload?.item?.count ?? 0));
          }
        } catch {
          // no-op
        }
      };

      const handleMarkAllNotificationsRead = async () => {
        const unreadIds = notifications
          .filter((item) => item.source === 'notification' && !item.is_read)
          .map((item) => item.id);
        if (unreadIds.length === 0) return;
        await Promise.all(unreadIds.map((id) => handleMarkNotificationRead(id)));
      };

      const notificationItems = useMemo(() => {
        if (notificationFilter === 'unread') {
          return notifications.filter((item) => !item.is_read);
        }
        return notifications;
      }, [notifications, notificationFilter]);

      const handleOpenNotification = useCallback(async (notification) => {
        const href = String(notification?.payload?.href || '').trim();
        if (!href) return;
        const routeMap = {
          '/jobs': 'jobs',
          '/maintenance': 'maintenance',
          '/safety': 'safety',
          '/messages': 'messages',
          '/inventory': 'inventory',
          '/schedule': 'schedule',
          '/fleet': 'fleet',
          '/team': 'team',
          '/reports': 'reports',
          '/vendors': 'vendors',
          '/bids': 'bids',
          '/documents': 'documents',
        };
        const [path] = href.split('?');
        setCurrentView(routeMap[path] || 'dashboard');
        setShowNotifications(false);
        if (!notification.is_read) {
          await handleMarkNotificationRead(notification.id);
        }
      }, [setCurrentView]);

      const handleRespondToEventInvite = useCallback(async (notification, responseStatus) => {
        const eventId = String(notification?.payload?.eventId || '').trim();
        if (!eventId) return;
        try {
          const response = await fetch(`/api/calendar/events/${eventId}/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responseStatus }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) return;
          setNotifications((prev) =>
            prev.map((item) =>
              String(item.id) === String(notification.id)
                ? {
                    ...item,
                    is_read: true,
                    read_at: new Date().toISOString(),
                    message:
                      responseStatus === 'accepted'
                        ? 'You accepted this event invitation.'
                        : 'You declined this event invitation.',
                  }
                : item
            )
          );
          await loadNotifications();
          setCalendarRefreshVersion((prev) => prev + 1);
        } catch {
          // no-op
        }
      }, [loadNotifications]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad =
          currentView === 'dashboard' ||
          currentView === 'jobs' ||
          currentView === 'schedule' ||
          currentView === 'reports' ||
          currentView === 'team';
        if (!shouldLoad || moduleLoadedRef.current.jobs) return () => { isMounted = false; };

        const loadJobs = async () => {
          try {
            setJobsLoading(true);
            const response = await fetch('/api/jobs', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load jobs');
            }
            if (isMounted) {
              setJobs(payload.items || payload.jobs || []);
              moduleLoadedRef.current.jobs = true;
            }
          } catch {
            if (isMounted) {
              setJobs([]);
            }
          } finally {
            if (isMounted) {
              setJobsLoading(false);
            }
          }
        };

        loadJobs();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        loadNotifications();
      }, [loadNotifications]);

      useEffect(() => {
        const poll = () => {
          if (typeof document !== 'undefined' && document.hidden) return;
          loadNotifications();
        };
        const intervalId = setInterval(poll, 30000);
        const onVisibilityChange = () => {
          if (!document.hidden) {
            loadNotifications();
          }
        };
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }
        return () => {
          clearInterval(intervalId);
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
          }
        };
      }, [loadNotifications]);

      useEffect(() => {
        const shouldLoad = currentView === 'dashboard' || currentView === 'safety';
        if (!shouldLoad || moduleLoadedRef.current.safety) return;
        loadSafetyLogs().finally(() => {
          moduleLoadedRef.current.safety = true;
        });
      }, [currentView, loadSafetyLogs]);

      useEffect(() => {
        const shouldLoad = currentView === 'dashboard' || currentView === 'training';
        if (!shouldLoad || moduleLoadedRef.current.training) return;
        loadTraining().finally(() => {
          moduleLoadedRef.current.training = true;
        });
      }, [currentView, loadTraining]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'bids' || currentView === 'reports';
        if (!shouldLoad || moduleLoadedRef.current.costCodes) return () => { isMounted = false; };

        const loadCostCodes = async () => {
          try {
            setCostCodesLoading(true);
            const response = await fetch('/api/cost-codes', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load cost codes');
            }
            if (isMounted) {
              setCostCodes(payload.cost_codes || []);
              moduleLoadedRef.current.costCodes = true;
            }
          } catch {
            if (isMounted) {
              setCostCodes([]);
            }
          } finally {
            if (isMounted) {
              setCostCodesLoading(false);
            }
          }
        };

        loadCostCodes();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'bids';
        if (!shouldLoad || moduleLoadedRef.current.bids) return () => { isMounted = false; };

        const loadBids = async () => {
          try {
            setBidsLoading(true);
            const response = await fetch('/api/bids', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load bids');
            }
            if (isMounted) {
              setBids(payload.bids || []);
              moduleLoadedRef.current.bids = true;
            }
          } catch {
            if (isMounted) {
              setBids([]);
            }
          } finally {
            if (isMounted) {
              setBidsLoading(false);
            }
          }
        };

        loadBids();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'vendors';
        if (!shouldLoad || moduleLoadedRef.current.vendors) return () => { isMounted = false; };

        const loadVendors = async () => {
          try {
            setVendorsLoading(true);
            const response = await fetch('/api/vendors', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load vendors');
            }
            if (isMounted) {
              setVendors(payload.items || payload.vendors || []);
              moduleLoadedRef.current.vendors = true;
            }
          } catch {
            if (isMounted) {
              setVendors([]);
            }
          } finally {
            if (isMounted) {
              setVendorsLoading(false);
            }
          }
        };

        loadVendors();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'inventory' || currentView === 'maintenance';
        if (!shouldLoad || moduleLoadedRef.current.inventory) return () => { isMounted = false; };

        const loadInventory = async () => {
          try {
            setInventoryLoading(true);
            const response = await fetch('/api/inventory', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load inventory');
            }
            if (isMounted) {
              setInventory(payload.items || payload.inventory || []);
              moduleLoadedRef.current.inventory = true;
            }
          } catch {
            if (isMounted) {
              setInventory([]);
            }
          } finally {
            if (isMounted) {
              setInventoryLoading(false);
            }
          }
        };

        loadInventory();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad =
          currentView === 'dashboard' ||
          currentView === 'team' ||
          currentView === 'jobs' ||
          currentView === 'schedule' ||
          currentView === 'messages' ||
          currentView === 'training';
        if (!shouldLoad || moduleLoadedRef.current.employees) return () => { isMounted = false; };

        const loadEmployees = async () => {
          try {
            setEmployeesLoading(true);
            const response = await fetch('/api/employees', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load employees');
            }
            if (isMounted) {
              setEmployees(payload.employees || []);
              moduleLoadedRef.current.employees = true;
            }
          } catch {
            if (isMounted) {
              setEmployees([]);
            }
          } finally {
            if (isMounted) {
              setEmployeesLoading(false);
            }
          }
        };

        loadEmployees();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'reports';
        if (!shouldLoad || moduleLoadedRef.current.dailyReports) return () => { isMounted = false; };

        const loadDailyReports = async () => {
          try {
            setDailyReportsLoading(true);
            const response = await fetch('/api/daily-reports', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load daily reports');
            }
            if (isMounted) {
              setDailyReports(payload.dailyReports || []);
              moduleLoadedRef.current.dailyReports = true;
            }
          } catch {
            if (isMounted) {
              setDailyReports([]);
            }
          } finally {
            if (isMounted) {
              setDailyReportsLoading(false);
            }
          }
        };

        loadDailyReports();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad = currentView === 'dashboard' || currentView === 'maintenance' || currentView === 'fleet';
        if (!shouldLoad || moduleLoadedRef.current.workOrders) return () => { isMounted = false; };

        const loadWorkOrders = async () => {
          try {
            setWorkOrdersLoading(true);
            const response = await fetch('/api/work-orders', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load work orders');
            }
            if (isMounted) {
              setWorkOrders(payload.workOrders || []);
              moduleLoadedRef.current.workOrders = true;
            }
          } catch {
            if (isMounted) {
              setWorkOrders([]);
            }
          } finally {
            if (isMounted) {
              setWorkOrdersLoading(false);
            }
          }
        };

        loadWorkOrders();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        let isMounted = true;
        const shouldLoad =
          currentView === 'dashboard' ||
          currentView === 'fleet' ||
          currentView === 'jobs' ||
          currentView === 'schedule' ||
          currentView === 'maintenance';
        if (!shouldLoad || moduleLoadedRef.current.equipment) return () => { isMounted = false; };

        const loadEquipment = async () => {
          try {
            setEquipmentLoading(true);
            const response = await fetch('/api/equipment', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load equipment');
            }
            if (isMounted) {
              setEquipment(payload.equipment || []);
              moduleLoadedRef.current.equipment = true;
            }
          } catch {
            if (isMounted) {
              setEquipment([]);
            }
          } finally {
            if (isMounted) {
              setEquipmentLoading(false);
            }
          }
        };

        loadEquipment();

        return () => {
          isMounted = false;
        };
      }, [currentView]);

      useEffect(() => {
        loadNav();
      }, [loadNav]);

      useEffect(() => {
        setHeaderDateLabel(getUtcDateLabel());
      }, []);

      const handleRoleSwitch = useCallback(async (nextUiRole) => {
        try {
          setActingRoleSaving(true);
          const requestedRole = mapUiRoleToServerRole(nextUiRole);
          const response = await fetch('/api/rbac/acting-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: requestedRole }),
          });
          if (!response.ok) return;
          await loadNav();
          setCurrentView('dashboard');
        } catch {
          // no-op
        } finally {
          setActingRoleSaving(false);
          setShowRoleSelector(false);
        }
      }, [loadNav, mapUiRoleToServerRole]);

      const navCountsByKey = {
        messages: 3,
        jobs: jobs.filter(j => j.status === 'active').length,
        fleet: equipment.length,
        team: employees.length,
        inventory: inventory.filter(i => i.qtyOnHand <= i.reorderPoint).length,
        maintenance: workOrders.filter(w => w.status !== 'completed').length,
        training: trainingData.filter((t) => {
          const assignedCount = (t.assignedEmployeeIds || []).length || employees.length || 1;
          return t.required && t.completedBy.length < assignedCount;
        }).length,
        bids: bids.filter(b => b.status === 'pending').length,
      };

      const navItems = serverNavItems.map((item) => ({
        id: item.key,
        icon: item.iconKey || 'circle',
        label: item.label,
        count: navCountsByKey[item.key],
      }));

      useEffect(() => {
        if (!navLoaded) return;
        if (navItems.length === 0) {
          if (currentView !== 'dashboard') setCurrentView('dashboard');
          return;
        }
        if (!navItems.some((item) => item.id === currentView)) {
          setCurrentView('dashboard');
        }
      }, [navItems, currentView, navLoaded]);

      useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('app.currentView', currentView);
      }, [currentView]);

      useEffect(() => {
        if (!mobileSidebarOpen) return undefined;
        const closeOnEscape = (event) => {
          if (event.key === 'Escape') setMobileSidebarOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
      }, [mobileSidebarOpen]);

      useEffect(() => {
        const syncTableLabels = () => {
          const tables = document.querySelectorAll('table');
          tables.forEach((table) => {
            const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
              (th.textContent || '').trim()
            );
            if (!headers.length) return;
            table.querySelectorAll('tbody tr').forEach((row) => {
              Array.from(row.children).forEach((cell, index) => {
                if (cell instanceof HTMLElement && !cell.dataset.label) {
                  cell.dataset.label = headers[index] || '';
                }
              });
            });
          });
        };

        const id = window.requestAnimationFrame(syncTableLabels);
        return () => window.cancelAnimationFrame(id);
      }, [currentView, jobs, equipment, workOrders, dailyReports, inventory, bids, vendors, trainingData]);

      const dashboardViewUi = {
        StatGrid,
        StatCard,
        Card,
        Button,
        Icon,
        Badge,
        ProgressBar,
        LeafletMap,
        formatCurrency,
        formatDate,
        getDaysUntil,
        getPriorityColor,
        getStatusColor,
      };

      const bidsViewUi = {
        StatGrid,
        StatCard,
        SearchInput,
        Card,
        Icon,
        Button,
        Badge,
        formatCurrency,
        getStatusColor,
        formatDate,
      };

      const documentsViewUi = {
        SearchInput,
        Button,
        Icon,
        Card,
        formatDate,
      };
      const sharedViewUi = {
        SearchInput,
        Card,
        Button,
        Icon,
        Badge,
        AttachmentPanel,
        formatDate,
      };

      const renderView = () => {
        switch(currentView) {
          case 'dashboard': return <DashboardView jobs={jobs} jobsLoading={jobsLoading} equipment={equipment} employees={employees} workOrders={workOrders} inventory={inventory} currentRole={currentRole} setCurrentView={setCurrentView} setShowModal={setShowModal} ui={dashboardViewUi} />;
          case 'messages': return <MessagesView employees={employees} ui={sharedViewUi} />;
          case 'schedule': return <ScheduleView equipment={equipment} employees={employees} scheduleData={scheduleData} setScheduleData={setScheduleData} currentRole={currentRole} setShowModal={setShowModal} ui={sharedViewUi} />;
          case 'jobs': return <JobsView jobs={jobs} jobsLoading={jobsLoading} setJobs={setJobs} equipment={equipment} setEquipment={setEquipment} employees={employees} setEmployees={setEmployees} ui={sharedViewUi} />;
          case 'fleet': return <FleetView equipment={equipment} equipmentLoading={equipmentLoading} setEquipment={setEquipment} jobs={jobs} workOrders={workOrders} setShowModal={setShowModal} currentRole={currentRole} />;
          case 'team': return <TeamView employees={employees} employeesLoading={employeesLoading} setEmployees={setEmployees} jobs={jobs} setShowModal={setShowModal} currentRole={currentRole} />;
          case 'inventory': return <InventoryView inventory={inventory} inventoryLoading={inventoryLoading} setInventory={setInventory} jobs={jobs} vendors={vendors} setShowModal={setShowModal} />;
          case 'maintenance': return <MaintenanceView workOrders={workOrders} workOrdersLoading={workOrdersLoading} setWorkOrders={setWorkOrders} equipment={equipment} employees={employees} setShowModal={setShowModal} />;
          case 'training': return <TrainingView trainingData={trainingData} setTrainingData={setTrainingData} employees={employees} setShowModal={setShowModal} trainingLoading={trainingLoading} trainingError={trainingError} onRefreshTraining={loadTraining} />;
          case 'safety': return <SafetyView employees={employees} setShowModal={setShowModal} safetyLogs={safetyLogs} safetyLogsLoading={safetyLogsLoading} safetyLogsError={safetyLogsError} onDeleteSafetyLog={handleDeleteSafetyLog} deleteLoadingId={safetyDeleteLoadingId} />;
          case 'bids': return <BidsView bids={bids} bidsLoading={bidsLoading} setBids={setBids} jobs={jobs} ui={bidsViewUi} currentRole={currentRole} />;
          case 'vendors': return <VendorsView vendors={vendors} vendorsLoading={vendorsLoading} setVendors={setVendors} jobs={jobs} inventory={inventory} />;
          case 'reports': return <ReportsView jobs={jobs} equipment={equipment} employees={employees} dailyReports={dailyReports} dailyReportsLoading={dailyReportsLoading} setDailyReports={setDailyReports} setShowModal={setShowModal} />;
          case 'costing': return <JobCostingView jobs={jobs} costCodes={costCodes} costCodesLoading={costCodesLoading} setCostCodes={setCostCodes} />;
          case 'finance': return <FinanceView jobs={jobs} bids={bids} vendors={vendors} inventory={inventory} workOrders={workOrders} currentRole={currentRole} />;
          case 'subscribe': return <SubscribeView employees={employees} currentRole={currentRole} />;
          case 'settings': return <SettingsView employees={employees} currentUser={currentUser} currentRole={currentRole} />;
          case 'audit': return <AuditView currentRole={currentRole} />;
          case 'marketing': return <MarketingView />;
          case 'integrations': return <IntegrationsView />;
          case 'documents': return <DocumentsView currentRole={currentRole} ui={documentsViewUi} />;
          default: return <DashboardView jobs={jobs} jobsLoading={jobsLoading} equipment={equipment} employees={employees} workOrders={workOrders} inventory={inventory} currentRole={currentRole} setCurrentView={setCurrentView} setShowModal={setShowModal} ui={dashboardViewUi} />;
        }
      };

      return (
        <div className="app-shell relative flex h-screen bg-gray-50">
          {mobileSidebarOpen && (
            <button
              aria-label="Close sidebar"
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            />
          )}

          {/* Sidebar */}
          <aside
            className={`fixed left-0 top-0 z-40 h-full ${sidebarCollapsed ? 'w-16' : 'w-64'} bg-dark-900 text-white flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="p-4 border-b border-dark-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
                  <Icon name="mountain" className="text-white text-lg" />
                </div>
                {!sidebarCollapsed && (
                  <div>
                    <h1 className="font-dozer text-xl tracking-wide">GROUNDWORK</h1>
                    <p className="text-xs text-gray-400 font-dozer tracking-wider">PRO</p>
                  </div>
                )}
              </div>
            </div>

            <nav className="flex-1 p-2 space-y-1 overflow-y-auto scrollbar-thin">
              {navItems.map(item => (
                <button
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  onClick={() => {
                    setCurrentView(item.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    currentView === item.id
                      ? 'bg-brand-500 text-white'
                      : 'text-gray-300 hover:bg-dark-700 hover:text-white'
                  }`}
                >
                  <Icon name={item.icon} className="text-lg w-5" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="flex-1 text-left text-sm">{item.label}</span>
                      {item.count !== undefined && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${currentView === item.id ? 'bg-brand-600' : 'bg-dark-700'}`}>
                          {item.count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              ))}
            </nav>

            <div className="p-2 border-t border-dark-700 hidden lg:block">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-gray-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
              >
                <Icon name={sidebarCollapsed ? 'chevron-right' : 'chevron-left'} />
                {!sidebarCollapsed && <span className="text-sm">Collapse</span>}
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-3 sm:px-4 md:px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setMobileSidebarOpen(true)}
                    className="inline-flex lg:hidden items-center justify-center w-10 h-10 rounded-lg border border-gray-300 text-gray-700"
                    aria-label="Open sidebar"
                  >
                    <Icon name="bars" />
                  </button>
                  <div>
                    <h1 className="text-lg md:text-xl font-semibold text-gray-900 capitalize">{currentView.replace('-', ' ')}</h1>
                    <p className="text-xs sm:text-sm text-gray-500" suppressHydrationWarning>
                      {headerDateLabel || getUtcDateLabel()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Role Selector */}
                  <div className="relative hidden md:block">
                    <button
                      onClick={() => {
                        if (!canSwitchRoleView) return;
                        setShowRoleSelector(!showRoleSelector);
                      }}
                      disabled={actingRoleSaving || !canSwitchRoleView}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                        canSwitchRoleView ? 'bg-gray-100 hover:bg-gray-200' : 'bg-gray-100 opacity-80 cursor-default'
                      }`}
                    >
                      <Icon name={ROLES[currentRole].icon} className={ROLES[currentRole].color} />
                      <span className="text-sm font-medium text-gray-700">{ROLES[currentRole].label}</span>
                      {canSwitchRoleView && <Icon name="chevron-down" className="text-gray-400 text-xs" />}
                    </button>
                    {showRoleSelector && canSwitchRoleView && (
                      <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                        <div className="px-3 py-2 border-b border-gray-100">
                          <p className="text-xs font-medium text-gray-500 uppercase">Switch Role View</p>
                        </div>
                        {Object.entries(ROLES).map(([key, role]) => (
                          <button
                            key={key}
                            disabled={actingRoleSaving}
                            onClick={() => { handleRoleSwitch(key); }}
                            className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors ${currentRole === key ? 'bg-brand-50' : ''}`}
                          >
                            <Icon name={role.icon} className={`${role.color} w-5`} />
                            <span className="text-sm text-gray-700">{role.label}</span>
                            {currentRole === key && <Icon name="check" className="ml-auto text-brand-500" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="hidden sm:inline-flex"
                    onClick={() => setShowModal({ type: 'quick-actions' })}
                    aria-label="Quick Actions"
                    title="Quick Actions"
                  >
                    <Icon name="bolt" />
                  </Button>
                  {/* Notifications */}
                  <div className="relative">
                    <button
                      onClick={() => {
                        const nextValue = !showNotifications;
                        setShowNotifications(nextValue);
                        if (nextValue) loadNotifications();
                      }}
                      className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                    >
                      <Icon name="bell" />
                      {unreadNotificationsCount > 0 && (
                        <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-medium">
                          {unreadNotificationsCount}
                        </span>
                      )}
                    </button>
                    {showNotifications && (
                      <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                          <h3 className="font-semibold text-gray-900">Notifications</h3>
                          <button
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                            onClick={handleMarkAllNotificationsRead}
                          >
                            Mark all read
                          </button>
                        </div>
                        <div className="px-3 py-2 border-b border-gray-100 bg-white flex items-center gap-2">
                          <button
                            className={`px-2 py-1 text-xs rounded ${notificationFilter === 'all' ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
                            onClick={() => setNotificationFilter('all')}
                          >
                            All
                          </button>
                          <button
                            className={`px-2 py-1 text-xs rounded ${notificationFilter === 'unread' ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
                            onClick={() => setNotificationFilter('unread')}
                          >
                            Unread
                          </button>
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                          {notificationsLoading ? (
                            <div className="px-4 py-3 text-sm text-gray-500">Loading notifications...</div>
                          ) : notificationItems.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-500">No notifications</div>
                          ) : (
                            notificationItems.map((notification) => {
                              const visual = notificationVisuals[notification.notification_type] || notificationVisuals.default;
                              return (
                                <div key={notification.id} className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${!notification.is_read ? 'bg-brand-50/30' : ''}`}>
                                  <div className="flex gap-3">
                                    <div className={`w-10 h-10 rounded-full ${visual.containerClass} flex items-center justify-center flex-shrink-0`}>
                                      <Icon name={visual.icon} className={visual.iconClass} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium text-gray-900 text-sm">{notification.title}</p>
                                        {!notification.is_read && <span className="w-2 h-2 bg-brand-500 rounded-full"></span>}
                                      </div>
                                      {notification.actorName && (
                                        <p className="text-xs text-gray-500">{notification.actorName}</p>
                                      )}
                                      <p className="text-sm text-gray-600">{notification.message}</p>
                                      <div className="mt-1 flex items-center justify-between gap-3">
                                        <p className="text-xs text-gray-400">{formatNotificationTime(notification.created_at)}</p>
                                        <div className="flex items-center gap-3">
                                          {notification.source === 'notification' &&
                                            notification.notification_type === 'event_invited' &&
                                            !notification.is_read &&
                                            notification?.payload?.eventId && (
                                              <>
                                                <button
                                                  className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
                                                  onClick={() => handleRespondToEventInvite(notification, 'accepted')}
                                                >
                                                  Accept
                                                </button>
                                                <button
                                                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                                                  onClick={() => handleRespondToEventInvite(notification, 'declined')}
                                                >
                                                  Decline
                                                </button>
                                              </>
                                            )}
                                          {notification?.payload?.href && (
                                            <button
                                              className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                                              onClick={() => handleOpenNotification(notification)}
                                            >
                                              Open
                                            </button>
                                          )}
                                          {!notification.is_read && (
                                            <button
                                              className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                                              onClick={() => handleMarkNotificationRead(notification.id)}
                                            >
                                              Mark read
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* User Menu */}
                  <div className="relative sm:pl-3 sm:border-l sm:border-gray-200">
                    <button
                      onClick={() => setShowUserMenu(!showUserMenu)}
                      className="flex items-center gap-2 hover:bg-gray-100 rounded-lg p-1 sm:pr-2 transition-colors"
                    >
                      <div className="w-8 h-8 bg-brand-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                        {currentUser?.name?.split(' ').map(n => n[0]).join('') || 'JD'}
                      </div>
                      <span className="text-sm font-medium text-gray-700 hidden lg:inline">{currentUser?.name || 'John Doe'}</span>
                      <Icon name="chevron-down" className="text-gray-400 text-xs" />
                    </button>
                    {showUserMenu && (
                      <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <p className="font-medium text-gray-900">{currentUser?.name || 'John Doe'}</p>
                          <p className="text-sm text-gray-500">{currentUser?.email || 'john@company.com'}</p>
                          <p className="text-xs text-gray-400 mt-1">{currentUser?.company || 'Demo Company'}</p>
                        </div>
                        <div className="py-1">
                          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Icon name="user" className="text-gray-400" /> My Profile
                          </button>
                          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Icon name="gear" className="text-gray-400" /> Account Settings
                          </button>
                          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Icon name="building" className="text-gray-400" /> Company Settings
                          </button>
                          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            <Icon name="credit-card" className="text-gray-400" /> Billing
                          </button>
                        </div>
                        <div className="border-t border-gray-100 pt-1">
                          <button
                            onClick={onLogout}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Icon name="right-from-bracket" className="text-red-500" /> Sign Out
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </header>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 md:px-6 py-4 md:py-6">
              <div className="max-w-screen-2xl mx-auto">
                {renderView()}
              </div>
            </div>
          </main>

          {/* Modals */}
          <QuickActionsModal isOpen={showModal.type === 'quick-actions'} onClose={() => setShowModal({ type: null })} setShowModal={setShowModal} />
          <CalendarEventModal
            isOpen={showModal.type === 'calendar-event'}
            onClose={() => setShowModal({ type: null })}
            employees={employees}
            currentRole={currentRole}
            initialData={showModal.data}
            onCreated={() => setCalendarRefreshVersion((prev) => prev + 1)}
          />
          <TimeClockModal isOpen={showModal.type === 'time-clock'} onClose={() => setShowModal({ type: null })} employees={employees} jobs={jobs} setTimeEntries={setTimeEntries} />
          <EquipmentCheckInModal isOpen={showModal.type === 'equipment-checkin'} onClose={() => setShowModal({ type: null })} equipment={equipment} setEquipment={setEquipment} employees={employees} jobs={jobs} />
          <DailyReportModal isOpen={showModal.type === 'daily-report'} onClose={() => setShowModal({ type: null })} jobs={jobs} employees={employees} dailyReports={dailyReports} setDailyReports={setDailyReports} />
          <WorkOrderModal isOpen={showModal.type === 'work-order'} onClose={() => setShowModal({ type: null })} equipment={equipment} employees={employees} workOrders={workOrders} setWorkOrders={setWorkOrders} data={showModal.data} />
          <SafetyModal isOpen={showModal.type === 'safety'} onClose={() => setShowModal({ type: null })} employees={employees} jobs={jobs} onSubmitSafetyLog={handleCreateSafetyLog} submitLoading={safetyCreateLoading} />
        </div>
      );
    };

    // ============================================
    // LEAFLET MAP COMPONENT
    // ============================================
    const LeafletMap = ({ equipment, jobs }) => {
      const mapRef = useRef(null);
      const mapInstanceRef = useRef(null);
      const [mapLoadError, setMapLoadError] = useState(false);
      const hasValidCoords = (lat, lng) =>
        Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

      useEffect(() => {
        let isMounted = true;
        const setupMap = async () => {
          try {
            const L = await import(/* webpackMode: "eager" */ 'leaflet');
            if (!isMounted || !mapRef.current || mapInstanceRef.current) return;

            // Initialize map centered on Cincinnati
            mapInstanceRef.current = L.map(mapRef.current).setView([39.1031, -84.5120], 10);

            // Add tile layer (OpenStreetMap)
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors'
            }).addTo(mapInstanceRef.current);

            // Custom orange icon for equipment
            const equipIcon = L.divIcon({
              className: 'custom-marker',
              html: '<div style="background: #f97316; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });

            // Add equipment markers
            equipment.filter(e => e.status === 'active' && hasValidCoords(e.lat, e.lng)).forEach(eq => {
              const job = jobs.find(j => j.id === eq.jobId);
              L.marker([Number(eq.lat), Number(eq.lng)], { icon: equipIcon })
                .addTo(mapInstanceRef.current)
                .bindPopup(`<b>${eq.name}</b><br/>${eq.type}<br/>Job: ${job?.name || 'Unassigned'}<br/>Hours: ${eq.hours.toLocaleString()}`);
            });

            // Add job site markers (blue)
            const jobIcon = L.divIcon({
              className: 'custom-marker',
              html: '<div style="background: #3b82f6; width: 20px; height: 20px; border-radius: 4px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });

            jobs.filter(j => j.status === 'active' && hasValidCoords(j.lat, j.lng)).forEach(job => {
              L.marker([Number(job.lat), Number(job.lng)], { icon: jobIcon })
                .addTo(mapInstanceRef.current)
                .bindPopup(`<b>${job.name}</b><br/>${job.client}<br/>${job.address}`);
            });
          } catch {
            if (isMounted) setMapLoadError(true);
          }
        };

        setupMap();

        return () => {
          isMounted = false;
          if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }
        };
      }, [equipment, jobs]);

      return (
        <div className="relative">
          {mapLoadError ? (
            <div className="h-64 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-sm text-gray-500">
              Map unavailable
            </div>
          ) : (
            <>
              <div ref={mapRef} className="h-64 rounded-lg overflow-hidden" style={{ zIndex: 0 }}></div>
              <div className="absolute bottom-2 left-2 bg-white/95 rounded px-3 py-2 text-xs shadow-lg z-10">
                <div className="flex items-center gap-4">
                  <span><span className="inline-block w-3 h-3 rounded-full bg-brand-500 mr-1"></span> Equipment</span>
                  <span><span className="inline-block w-3 h-3 rounded bg-blue-500 mr-1"></span> Job Sites</span>
                </div>
              </div>
            </>
          )}
        </div>
      );
    };

    // ============================================
    // SCHEDULE VIEW (Click-to-Add Calendar)
    // ============================================
    // ============================================
    const FleetView = ({ equipment, equipmentLoading, setEquipment, jobs, workOrders, setShowModal, currentRole }) => {
      const EQUIPMENT_TYPE_OPTIONS = useMemo(
        () => [
          'Excavator',
          'Dozer',
          'Haul Truck',
          'Backhoe',
          'Loader',
          'Grader',
          'Compactor',
        ],
        []
      );
      const [filter, setFilter] = useState('all');
      const [selectedEquipmentId, setSelectedEquipmentId] = useState(null);
      const [viewMode, setViewMode] = useState('grid');
      const [fleetItems, setFleetItems] = useState([]);
      const [fleetItemsLoading, setFleetItemsLoading] = useState(false);
      const [fleetItemsError, setFleetItemsError] = useState('');
      const [equipmentForm, setEquipmentForm] = useState({
        name: '',
        type: '',
        status: 'active',
        hours: 0,
        nextService: 0,
        fuelLevel: 0,
        dailyRate: 0,
        purchasePrice: 0,
        purchaseDate: '',
        lastUpdate: 'just now',
      });
      const [saveLoading, setSaveLoading] = useState(false);
      const [deleteLoading, setDeleteLoading] = useState(false);
      const [equipmentActionError, setEquipmentActionError] = useState('');
      const [selectedTypeOption, setSelectedTypeOption] = useState('Excavator');
      const [customTypeInput, setCustomTypeInput] = useState('');
      const normalizedRole = String(currentRole || '').trim().toLowerCase();
      const canManageFleet = ['executive', 'operations', 'admin', 'pm', 'mechanic'].includes(normalizedRole);

      const EquipmentTypeGlyph = useCallback(({ type, className = '' }) => {
        const normalized = String(type || '').trim().toLowerCase();
        const shared = {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: `w-6 h-6 ${className}`,
          'aria-hidden': true,
        };

        if (normalized.includes('excavator')) {
          return (
            <svg {...shared}>
              <rect x="3" y="14.5" width="10" height="3.5" rx="1.2" />
              <path d="M13 12l4-3.2 2 1.2-2.2 3.8" />
              <path d="M9 10.5h4v4H9z" />
              <circle cx="6.5" cy="19" r="1.2" />
              <circle cx="10.5" cy="19" r="1.2" />
            </svg>
          );
        }
        if (normalized.includes('dozer')) {
          return (
            <svg {...shared}>
              <rect x="3" y="14.5" width="9" height="3.5" rx="1.2" />
              <path d="M12 14.5h4l2 2.2-1.8 1.3H12z" />
              <path d="M8 10.5h5v4H8z" />
              <circle cx="6" cy="19" r="1.2" />
              <circle cx="10" cy="19" r="1.2" />
            </svg>
          );
        }
        if (normalized.includes('haul') || normalized.includes('truck')) {
          return (
            <svg {...shared}>
              <rect x="3" y="12.5" width="11" height="4.5" rx="1" />
              <path d="M14 13h4l2 2v2h-2" />
              <circle cx="7" cy="18.5" r="1.4" />
              <circle cx="16.5" cy="18.5" r="1.4" />
            </svg>
          );
        }
        if (normalized.includes('backhoe')) {
          return (
            <svg {...shared}>
              <rect x="4" y="13.5" width="8" height="4" rx="1" />
              <path d="M12 13.5h3.5l1.5 1.7-1.6 1.8H12z" />
              <path d="M6 11h4v2.5H6z" />
              <path d="M17 11l2.2-1.8 1.3 1.1-1.7 2.8" />
              <circle cx="7" cy="18.2" r="1.2" />
              <circle cx="10.5" cy="18.2" r="1.2" />
            </svg>
          );
        }
        if (normalized.includes('loader')) {
          return (
            <svg {...shared}>
              <rect x="4" y="13.5" width="9" height="4" rx="1" />
              <path d="M13 14h4.2l1.3 1.7-1.6 1.4H13z" />
              <path d="M6.5 10.5h4.5v3H6.5z" />
              <circle cx="7" cy="18.2" r="1.2" />
              <circle cx="11" cy="18.2" r="1.2" />
            </svg>
          );
        }
        if (normalized.includes('grader')) {
          return (
            <svg {...shared}>
              <path d="M3.5 15h11.5" />
              <path d="M8 12h4.5v3H8z" />
              <path d="M15 15l4.5-1.6" />
              <path d="M10.5 15.2l-2.2 2.2h5.1l2.1-2.2z" />
              <circle cx="6" cy="18.4" r="1.2" />
              <circle cx="13.8" cy="18.4" r="1.2" />
            </svg>
          );
        }
        if (normalized.includes('compactor')) {
          return (
            <svg {...shared}>
              <rect x="4" y="12.8" width="8.5" height="4.4" rx="1" />
              <circle cx="8" cy="18.5" r="1.2" />
              <circle cx="15.8" cy="17.8" r="2.1" />
              <path d="M12.5 14.8h2.5" />
              <path d="M7 10.8h4.2v2" />
            </svg>
          );
        }
        return (
          <svg {...shared}>
            <rect x="4" y="12.5" width="11" height="4.5" rx="1" />
            <path d="M15 13h3.8l1.8 2v2h-2" />
            <circle cx="7.2" cy="18.5" r="1.3" />
            <circle cx="16.2" cy="18.5" r="1.3" />
          </svg>
        );
      }, []);

      const filteredEquipment = fleetItems;
      const selectedEquipment = equipment.find(e => e.id === selectedEquipmentId);
      const selectedFleetItem = fleetItems.find((item) => String(item.id) === String(selectedEquipmentId));
      const equipmentJob = selectedEquipment ? jobs.find(j => j.id === selectedEquipment.jobId) : null;
      const equipmentWorkOrders = selectedEquipment ? workOrders.filter(w => w.equipmentId === selectedEquipment.id) : [];

      const loadFleetItems = useCallback(async (activeFilter = 'all') => {
        try {
          setFleetItemsLoading(true);
          setFleetItemsError('');
          const statusParam = activeFilter === 'maintenance' ? 'in_maintenance' : activeFilter;
          const response = await fetch(`/api/fleet/equipment?status=${encodeURIComponent(statusParam)}`, { cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok || !Array.isArray(payload?.items)) {
            throw new Error(payload?.error || 'Failed to load fleet status');
          }
          setFleetItems(payload.items);
        } catch (error) {
          setFleetItems([]);
          setFleetItemsError(error instanceof Error ? error.message : 'Failed to load fleet status');
        } finally {
          setFleetItemsLoading(false);
        }
      }, []);

      useEffect(() => {
        if (!selectedEquipment) return;
        setEquipmentForm({
          name: selectedEquipment.name || '',
          type: selectedEquipment.type || '',
          status: selectedEquipment.status || 'active',
          hours: Number(selectedEquipment.hours || 0),
          nextService: Number(selectedEquipment.nextService || 0),
          fuelLevel: Number(selectedEquipment.fuelLevel || 0),
          dailyRate: Number(selectedEquipment.dailyRate || 0),
          purchasePrice: Number(selectedEquipment.purchasePrice || 0),
          purchaseDate: selectedEquipment.purchaseDate || '',
          lastUpdate: selectedEquipment.lastUpdate || 'just now',
        });
        const existingType = String(selectedEquipment.type || '').trim();
        if (EQUIPMENT_TYPE_OPTIONS.includes(existingType)) {
          setSelectedTypeOption(existingType);
          setCustomTypeInput('');
        } else if (existingType) {
          setSelectedTypeOption('Custom / Misc');
          setCustomTypeInput(existingType);
        } else {
          setSelectedTypeOption('Excavator');
          setCustomTypeInput('');
        }
        setEquipmentActionError('');
      }, [EQUIPMENT_TYPE_OPTIONS, selectedEquipment]);

      useEffect(() => {
        loadFleetItems(filter);
      }, [filter, loadFleetItems]);

      const handleCreateEquipment = async () => {
        if (!canManageFleet) {
          setEquipmentActionError('Forbidden');
          return;
        }
        try {
          const baseCount = equipment.length + 1;
          const response = await fetch('/api/equipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `New Equipment ${baseCount}`,
              type: 'Equipment',
              status: 'active',
              hours: 0,
              nextService: 0,
              fuelLevel: 100,
              dailyRate: 0,
              purchasePrice: 0,
              purchaseDate: '',
              lastUpdate: 'just now',
            }),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          const createdEquipment = payload?.equipment || payload?.item;
          if (!response.ok || !createdEquipment) {
            const message = payload?.error || raw || response.statusText || 'Failed to create equipment';
            setEquipmentActionError(message);
            console.warn('Create equipment failed', message);
            return;
          }
          setEquipment((prev) => [createdEquipment, ...prev]);
          setSelectedEquipmentId(createdEquipment.id);
          await loadFleetItems(filter);
        } catch (error) {
          setEquipmentActionError('Failed to create equipment');
          console.warn('Create equipment failed', error);
        }
      };

      const handleSaveEquipment = async () => {
        if (!canManageFleet) {
          setEquipmentActionError('Forbidden');
          return;
        }
        if (!selectedEquipment) return;
        setSaveLoading(true);
        setEquipmentActionError('');
        try {
          const updates = {};
          if (equipmentForm.name !== (selectedEquipment.name || '')) updates.name = equipmentForm.name;
          if (equipmentForm.type !== (selectedEquipment.type || '')) updates.type = equipmentForm.type;
          if (equipmentForm.status !== (selectedEquipment.status || 'active')) updates.status = equipmentForm.status;
          if (Number(equipmentForm.hours) !== Number(selectedEquipment.hours || 0)) updates.hours = Number(equipmentForm.hours);
          if (Number(equipmentForm.nextService) !== Number(selectedEquipment.nextService || 0)) updates.nextService = Number(equipmentForm.nextService);
          if (Number(equipmentForm.fuelLevel) !== Number(selectedEquipment.fuelLevel || 0)) updates.fuelLevel = Number(equipmentForm.fuelLevel);
          if (Number(equipmentForm.dailyRate) !== Number(selectedEquipment.dailyRate || 0)) updates.dailyRate = Number(equipmentForm.dailyRate);
          if (Number(equipmentForm.purchasePrice) !== Number(selectedEquipment.purchasePrice || 0)) updates.purchasePrice = Number(equipmentForm.purchasePrice);
          if (equipmentForm.purchaseDate !== (selectedEquipment.purchaseDate || '')) updates.purchaseDate = equipmentForm.purchaseDate;
          if (equipmentForm.lastUpdate !== (selectedEquipment.lastUpdate || 'just now')) updates.lastUpdate = equipmentForm.lastUpdate;

          if (Object.keys(updates).length === 0) {
            setSaveLoading(false);
            return;
          }

          const response = await fetch(`/api/equipment/${selectedEquipment.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          const updatedEquipment = payload?.equipment || payload?.item;
          if (!response.ok || !updatedEquipment) {
            setEquipmentActionError(payload?.error || raw || 'Failed to save equipment');
            setSaveLoading(false);
            return;
          }
          setEquipment((prev) =>
            prev.map((item) => (item.id === selectedEquipment.id ? updatedEquipment : item))
          );
          await loadFleetItems(filter);
        } catch {
          setEquipmentActionError('Failed to save equipment');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleDeleteEquipment = async () => {
        if (!canManageFleet) {
          setEquipmentActionError('Forbidden');
          return;
        }
        if (!selectedEquipment) return;
        const confirmed = confirmDestructiveAction('this equipment');
        if (!confirmed) return;
        setDeleteLoading(true);
        setEquipmentActionError('');
        try {
          const response = await fetch(`/api/equipment/${selectedEquipment.id}`, {
            method: 'DELETE',
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setEquipmentActionError(payload?.error || raw || 'Failed to delete equipment');
            setDeleteLoading(false);
            return;
          }
          setEquipment((prev) => prev.filter((item) => item.id !== selectedEquipment.id));
          setSelectedEquipmentId(null);
          await loadFleetItems(filter);
        } catch {
          setEquipmentActionError('Failed to delete equipment');
        } finally {
          setDeleteLoading(false);
        }
      };

      const stats = {
        total: fleetItems.length,
        active: fleetItems.filter(e => String(e.status || '').toLowerCase() === 'active').length,
        idle: fleetItems.filter(e => String(e.status || '').toLowerCase() === 'idle').length,
        maintenance: fleetItems.filter(e => ['maintenance', 'in_maintenance', 'out_of_service'].includes(String(e.status || '').toLowerCase())).length,
        totalValue: equipment.reduce((sum, e) => sum + (e.purchasePrice || 0), 0),
      };

      return (
        <div className="space-y-6">
          {/* Stats */}
          <StatGrid desktopColsClass="md:grid-cols-5" testId="stats-grid">
            <StatCard icon="truck-monster" label="Total Fleet" value={stats.total} color="brand" />
            <StatCard icon="circle-check" label="Active" value={stats.active} color="green" />
            <StatCard icon="clock" label="Idle" value={stats.idle} color="yellow" />
            <StatCard icon="wrench" label="In Maintenance" value={stats.maintenance} color="red" />
            <StatCard icon="dollar-sign" label="Fleet Value" value={formatCurrency(stats.totalValue)} color="blue" />
          </StatGrid>

          {/* Filters & Actions */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 min-w-0">
              <div className="flex bg-gray-100 rounded-lg p-1 overflow-x-auto">
                {['all', 'assigned', 'idle', 'maintenance'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilter(status)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                      filter === status ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex bg-gray-100 rounded-lg p-1 w-fit">
                <button onClick={() => setViewMode('grid')} className={`p-2 rounded ${viewMode === 'grid' ? 'bg-white shadow' : ''}`}>
                  <Icon name="grip" />
                </button>
                <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-white shadow' : ''}`}>
                  <Icon name="list" />
                </button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" className="w-full sm:w-auto whitespace-nowrap" onClick={() => setShowModal({ type: 'equipment-checkin' })}>
                <Icon name="clipboard-check" className="mr-2" /> Check In/Out
              </Button>
              <Button variant="brand" className="w-full sm:w-auto whitespace-nowrap" onClick={handleCreateEquipment} disabled={!canManageFleet}>
                <Icon name="plus" className="mr-2" /> Add Equipment
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Equipment Grid/List */}
            <div className={`lg:col-span-2 ${viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'space-y-3'}`}>
              {equipmentLoading || fleetItemsLoading ? (
                <LoadingBlock testId="fleet-loading">Loading equipment...</LoadingBlock>
              ) : filteredEquipment.length === 0 ? (
                <EmptyState testId="fleet-empty">No equipment yet.</EmptyState>
              ) : filteredEquipment.map(eq => {
                const hoursToService = eq.nextService - eq.hours;

                return viewMode === 'grid' ? (
                  <Card
                    key={eq.id}
                    data-testid={`fleet-row-${eq.id}`}
                    className={`p-4 cursor-pointer transition-all ${selectedEquipmentId === eq.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                    onClick={() => setSelectedEquipmentId(eq.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          eq.derivedStatus === 'ASSIGNED'
                            ? 'bg-green-100'
                            : eq.derivedStatus === 'IDLE'
                              ? 'bg-yellow-100'
                              : 'bg-red-100'
                        }`}>
                          <EquipmentTypeGlyph type={eq.type} className={`${
                            eq.derivedStatus === 'ASSIGNED'
                              ? 'text-green-600'
                              : eq.derivedStatus === 'IDLE'
                                ? 'text-yellow-600'
                                : 'text-red-600'
                          }`} />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">{eq.name}</h4>
                          <p className="text-xs text-gray-500">{eq.type}</p>
                        </div>
                      </div>
                      <Badge className={getStatusColor(eq.status)}>{eq.status}</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      <div>
                        <p className="text-xs text-gray-500">Hours</p>
                        <p className="font-medium">{eq.hours.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Fuel</p>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={eq.fuelLevel} size="sm" color={eq.fuelLevel < 25 ? 'red' : 'green'} />
                          <span className="text-xs">{eq.fuelLevel}%</span>
                        </div>
                      </div>
                    </div>

                    {eq.currentJob && (
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Icon name="location-dot" />
                        {eq.currentJob.name}
                      </div>
                    )}
                    {!eq.currentJob && (
                      <div className="text-xs text-gray-500">Utilization: {String(eq.derivedStatus || 'IDLE').toLowerCase()}</div>
                    )}

                    {hoursToService < 150 && (
                      <div className="mt-2 text-xs text-yellow-600 flex items-center gap-1">
                        <Icon name="triangle-exclamation" />
                        Service in {hoursToService} hrs
                      </div>
                    )}
                  </Card>
                ) : (
                  <Card
                    key={eq.id}
                    data-testid={`fleet-row-${eq.id}`}
                    className={`p-3 cursor-pointer transition-all ${selectedEquipmentId === eq.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                    onClick={() => setSelectedEquipmentId(eq.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        eq.derivedStatus === 'ASSIGNED'
                          ? 'bg-green-100'
                          : eq.derivedStatus === 'IDLE'
                            ? 'bg-yellow-100'
                            : 'bg-red-100'
                      }`}>
                        <EquipmentTypeGlyph type={eq.type} className={`${
                          eq.derivedStatus === 'ASSIGNED'
                            ? 'text-green-600'
                            : eq.derivedStatus === 'IDLE'
                              ? 'text-yellow-600'
                              : 'text-red-600'
                        }`} />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{eq.name}</h4>
                        <p className="text-xs text-gray-500">{eq.type} • {eq.hours.toLocaleString()} hrs</p>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(eq.status)}>{eq.status}</Badge>
                        {eq.currentJob && <p className="text-xs text-gray-500 mt-1">{eq.currentJob.name}</p>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Equipment Detail */}
            {selectedEquipment ? (
              <Card className="p-4 h-fit sticky top-4 max-h-[calc(100vh-140px)] overflow-y-auto">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">{selectedEquipment.name}</h3>
                      <p className="text-sm text-gray-500">{selectedEquipment.type}</p>
                    </div>
                  <Badge className={getStatusColor(selectedEquipment.status)}>
                    {selectedEquipment.status}
                  </Badge>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Name</p>
                    <input
                      type="text"
                      value={equipmentForm.name}
                      onChange={(e) => setEquipmentForm({ ...equipmentForm, name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Type</p>
                    <select
                      value={selectedTypeOption}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSelectedTypeOption(next);
                        if (next !== 'Custom / Misc') {
                          setCustomTypeInput('');
                          setEquipmentForm({ ...equipmentForm, type: next });
                        } else {
                          setEquipmentForm({ ...equipmentForm, type: customTypeInput || '' });
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      {EQUIPMENT_TYPE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="Custom / Misc">Custom / Misc</option>
                    </select>
                    {selectedTypeOption === 'Custom / Misc' && (
                      <input
                        type="text"
                        value={customTypeInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setCustomTypeInput(value);
                          setEquipmentForm({ ...equipmentForm, type: value });
                        }}
                        placeholder="e.g. Four Wheeler"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-2"
                      />
                    )}
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select
                      value={equipmentForm.status}
                      onChange={(e) => setEquipmentForm({ ...equipmentForm, status: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="idle">idle</option>
                      <option value="maintenance">maintenance</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">Total Hours</p>
                      <input
                        type="number"
                        value={equipmentForm.hours}
                        onChange={(e) => setEquipmentForm({ ...equipmentForm, hours: Number(e.target.value) || 0 })}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">Next Service</p>
                      <input
                        type="number"
                        value={equipmentForm.nextService}
                        onChange={(e) => setEquipmentForm({ ...equipmentForm, nextService: Number(e.target.value) || 0 })}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-2">Fuel Level</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <ProgressBar value={equipmentForm.fuelLevel} color={equipmentForm.fuelLevel < 25 ? 'red' : 'green'} />
                      </div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={equipmentForm.fuelLevel}
                        onChange={(e) => setEquipmentForm({ ...equipmentForm, fuelLevel: Number(e.target.value) || 0 })}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Current Assignment</p>
                    <p className="text-sm font-medium">{selectedFleetItem?.currentJob?.name || equipmentJob?.name || 'Unassigned'}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Last Location Update</p>
                    <input
                      type="text"
                      value={equipmentForm.lastUpdate}
                      onChange={(e) => setEquipmentForm({ ...equipmentForm, lastUpdate: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Daily Rate</p>
                    <input
                      type="number"
                      value={equipmentForm.dailyRate}
                      onChange={(e) => setEquipmentForm({ ...equipmentForm, dailyRate: Number(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Purchase Info</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        value={equipmentForm.purchasePrice}
                        onChange={(e) => setEquipmentForm({ ...equipmentForm, purchasePrice: Number(e.target.value) || 0 })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        type="date"
                        value={equipmentForm.purchaseDate}
                        onChange={(e) => setEquipmentForm({ ...equipmentForm, purchaseDate: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  {equipmentWorkOrders.length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-2">Work Orders</p>
                      {equipmentWorkOrders.map(wo => (
                        <div key={wo.id} className="p-2 bg-gray-50 rounded mb-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{wo.title}</span>
                            <Badge className={getStatusColor(wo.status)} >{wo.status}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {equipmentActionError && (
                    <InlineError>{equipmentActionError}</InlineError>
                  )}
                  {fleetItemsError && (
                    <InlineError>{fleetItemsError}</InlineError>
                  )}

                  <div className="flex gap-2 pt-4">
                    <Button variant="brand" size="sm" className="flex-1" onClick={handleSaveEquipment} disabled={!canManageFleet || saveLoading || deleteLoading}>
                      {saveLoading ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowModal({ type: 'work-order', data: { equipmentId: selectedEquipment.id } })}>
                      <Icon name="wrench" className="mr-1" /> Create WO
                    </Button>
                    <Button variant="danger" size="sm" className="flex-1" onClick={handleDeleteEquipment} disabled={!canManageFleet || saveLoading || deleteLoading}>
                      {deleteLoading ? 'Deleting...' : 'Delete'}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="truck-monster" className="text-4xl mb-2 text-gray-300" />
                <p>Select equipment to view details</p>
              </Card>
            )}
          </div>
        </div>
      );
    };

    // ============================================
    // TEAM VIEW
    // ============================================
    const TeamView = ({ employees, employeesLoading, setEmployees, jobs, setShowModal, currentRole }) => {
      const [filter, setFilter] = useState('all');
      const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
      const [employeeActionLoading, setEmployeeActionLoading] = useState(false);
      const [employeeActionError, setEmployeeActionError] = useState('');
      const [teamItems, setTeamItems] = useState([]);
      const [teamLoading, setTeamLoading] = useState(false);
      const [teamError, setTeamError] = useState('');
      const [showAssignModal, setShowAssignModal] = useState(false);
      const [assignForm, setAssignForm] = useState({ employeeId: '', jobId: '', date: new Date().toISOString().slice(0, 10), notes: '' });
      const [assignLoading, setAssignLoading] = useState(false);
      const [assignError, setAssignError] = useState('');
      const [assignSuccess, setAssignSuccess] = useState('');
      const [employeeForm, setEmployeeForm] = useState({
        name: '',
        role: 'operator',
        phone: '',
        email: '',
        hourlyRate: 0,
        jobId: '',
        status: 'active',
      });
      const [employeeSaveLoading, setEmployeeSaveLoading] = useState(false);
      const [employeeDeleteLoading, setEmployeeDeleteLoading] = useState(false);
      const [inviteFeedback, setInviteFeedback] = useState('');

      const filteredEmployees = teamItems.filter(emp => {
        if (filter === 'all') return true;
        if (filter === 'on-site') return emp.status === 'active';
        if (filter === 'off') return emp.status === 'inactive';
        return emp.role.toLowerCase().includes(filter.toLowerCase());
      });

      const selectedEmployee = teamItems.find(e => String(e.id) === String(selectedEmployeeId));
      const selectedEmployeeRecord = employees.find((employee) => String(employee.id) === String(selectedEmployeeId));
      const employeeJob = selectedEmployee?.assignedToday ? { name: selectedEmployee.assignedToday.jobName } : null;
      const canAssignFromTeam = ['executive', 'operations', 'foreman'].includes(currentRole);
      const canManageTeamProfiles = ['executive', 'operations', 'admin', 'pm'].includes(String(currentRole || '').toLowerCase());
      const canEditPay = ['executive', 'admin'].includes(String(currentRole || '').toLowerCase());

      const stats = {
        total: teamItems.length,
        onSite: teamItems.filter(e => e.status === 'active').length,
        roles: [...new Set(teamItems.map(e => e.role))],
      };

      const selectedEmployeeCertifications = Array.isArray(selectedEmployeeRecord?.certifications)
        ? selectedEmployeeRecord.certifications
        : Array.isArray(selectedEmployee?.certifications)
          ? selectedEmployee.certifications
          : [];
      const expiringCerts = selectedEmployeeCertifications.filter(c => getDaysUntil(c.expires) < 90) || [];

      const loadTeamItems = useCallback(async () => {
        try {
          setTeamLoading(true);
          setTeamError('');
          const response = await fetch('/api/team?limit=50', { cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok || !Array.isArray(payload?.items)) {
            throw new Error(payload?.error || 'Failed to load team');
          }
          const mappedItems = payload.items.map((item) => ({
            id: item.id,
            name: item.displayName || '',
            role: item.role || 'operator',
            status: item.status || 'inactive',
            user_id: item.userId || null,
            accountStatus: item.accountStatus || (item.userId ? 'active' : 'invited'),
            assignedToday: item.assignedToday || null,
            hoursThisWeek: Number(item.hoursThisWeek || 0),
            pay: item.pay || { visible: false, hourlyRate: 0, loadedHourlyCost: 0 },
            hourlyRate: Number(item.hourlyRate ?? item.pay?.hourlyRate ?? 0),
            certifications: Array.isArray(item.certifications) ? item.certifications : [],
            phone: item.phone || '',
            email: item.email || '',
            clockedInAt: item.clockedInAt,
          }));
          setTeamItems(mappedItems);
        } catch (error) {
          setTeamItems([]);
          setTeamError(error instanceof Error ? error.message : 'Failed to load team');
        } finally {
          setTeamLoading(false);
        }
      }, []);

      const refreshEmployees = useCallback(async () => {
        try {
          const response = await fetch('/api/employees', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error || 'Failed to refresh employees');
          }
          setEmployees(Array.isArray(payload?.employees) ? payload.employees : []);
        } catch (error) {
          setEmployeeActionError(error instanceof Error ? error.message : 'Failed to refresh employees');
        }
      }, [setEmployees]);

      useEffect(() => {
        loadTeamItems();
      }, [loadTeamItems]);

      useEffect(() => {
        if (!selectedEmployeeId) return;
        if (!teamItems.some((employee) => String(employee.id) === String(selectedEmployeeId))) {
          setSelectedEmployeeId(null);
        }
      }, [teamItems, selectedEmployeeId]);

      useEffect(() => {
        if (!selectedEmployee) return;
        setEmployeeForm({
          name: selectedEmployeeRecord?.name || selectedEmployee.name || '',
          role: selectedEmployeeRecord?.role || selectedEmployee.role || 'operator',
          phone: selectedEmployeeRecord?.phone || selectedEmployee.phone || '',
          email: selectedEmployeeRecord?.email || selectedEmployee.email || '',
          hourlyRate: Number(selectedEmployeeRecord?.hourlyRate || selectedEmployee.hourlyRate || 0),
          jobId:
            selectedEmployeeRecord?.jobId
              ? String(selectedEmployeeRecord.jobId)
              : selectedEmployee.assignedToday?.jobId
                ? String(selectedEmployee.assignedToday.jobId)
                : '',
          status: selectedEmployee.status === 'inactive' ? 'inactive' : 'active',
        });
        setEmployeeActionError('');
        setInviteFeedback('');
      }, [selectedEmployee, selectedEmployeeRecord]);

      const handleCreateEmployee = async () => {
        const name = window.prompt('Employee name');
        if (!name || !name.trim()) return;
        const role = window.prompt('Role', 'Laborer') || 'Laborer';
        setEmployeeActionLoading(true);
        setEmployeeActionError('');
        try {
          const response = await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), role: role.trim() || 'Laborer' }),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.employee) {
            setEmployeeActionError(payload?.error || raw || 'Failed to create employee');
            setEmployeeActionLoading(false);
            return;
          }
          setEmployees((prev) => [payload.employee, ...prev]);
          setSelectedEmployeeId(payload.employee.id);
          await loadTeamItems();
        } catch {
          setEmployeeActionError('Failed to create employee');
        } finally {
          setEmployeeActionLoading(false);
        }
      };

      const handleSaveEmployee = async () => {
        if (!selectedEmployee) return;
        setEmployeeSaveLoading(true);
        setEmployeeActionError('');
        try {
          const baselineName = selectedEmployeeRecord?.name || selectedEmployee.name || '';
          const baselineRole = (selectedEmployeeRecord?.role || selectedEmployee.role || 'operator').toLowerCase();
          const baselinePhone = selectedEmployeeRecord?.phone || selectedEmployee.phone || '';
          const baselineEmail = selectedEmployeeRecord?.email || selectedEmployee.email || '';
          const baselineHourlyRate = Number(selectedEmployeeRecord?.hourlyRate ?? selectedEmployee.hourlyRate ?? 0);
          const baselineJobId = selectedEmployeeRecord?.jobId
            ? String(selectedEmployeeRecord.jobId)
            : selectedEmployee.assignedToday?.jobId
              ? String(selectedEmployee.assignedToday.jobId)
              : '';
          const baselineStatus = selectedEmployee.status === 'inactive' ? 'inactive' : 'active';

          const requestBody = {};
          if ((employeeForm.name || '').trim() !== String(baselineName)) requestBody.name = (employeeForm.name || '').trim();
          if (String(employeeForm.role || '').toLowerCase() !== String(baselineRole)) requestBody.role = employeeForm.role || 'operator';
          if ((employeeForm.phone || '') !== String(baselinePhone)) requestBody.phone = employeeForm.phone || '';
          if ((employeeForm.email || '') !== String(baselineEmail)) requestBody.email = employeeForm.email || '';
          if (canEditPay && Number(employeeForm.hourlyRate || 0) !== Number(baselineHourlyRate)) {
            requestBody.hourlyRate = Number(employeeForm.hourlyRate || 0);
          }
          if (String(employeeForm.jobId || '') !== String(baselineJobId || '')) {
            requestBody.jobId = employeeForm.jobId || null;
          }
          if (String(employeeForm.status || '') !== String(baselineStatus || '')) {
            requestBody.status = employeeForm.status || 'active';
          }

          if (Object.keys(requestBody).length === 0) {
            setEmployeeSaveLoading(false);
            return;
          }

          const response = await fetch(`/api/employees/${selectedEmployee.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.employee) {
            setEmployeeActionError(payload?.error || raw || 'Failed to update employee');
            setEmployeeSaveLoading(false);
            return;
          }
          setEmployees((prev) =>
            prev.map((employee) => (String(employee.id) === String(selectedEmployee.id) ? payload.employee : employee))
          );
          await refreshEmployees();
          await loadTeamItems();
        } catch {
          setEmployeeActionError('Failed to update employee');
        } finally {
          setEmployeeSaveLoading(false);
        }
      };

      const handleDeleteEmployee = async () => {
        if (!selectedEmployee?.id) return;
        const confirmed = confirmDestructiveAction('this team member');
        if (!confirmed) return;
        setEmployeeDeleteLoading(true);
        setEmployeeActionError('');
        try {
          const response = await fetch(`/api/employees/${selectedEmployee.id}`, { method: 'DELETE' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setEmployeeActionError(payload?.error || 'Failed to delete employee');
            setEmployeeDeleteLoading(false);
            return;
          }
          setSelectedEmployeeId(null);
          await refreshEmployees();
          await loadTeamItems();
        } catch {
          setEmployeeActionError('Failed to delete employee');
        } finally {
          setEmployeeDeleteLoading(false);
        }
      };

      const getInvitePayload = () => {
        const email = (employeeForm.email || selectedEmployee?.email || '').trim();
        const name = (employeeForm.name || selectedEmployee?.name || '').trim();
        const role = String(employeeForm.role || selectedEmployee?.role || 'operator').toLowerCase();
        return { email, name, role };
      };

      const buildInviteLink = async () => {
        const { email, name, role } = getInvitePayload();
        if (!selectedEmployee?.id) throw new Error('Select employee first');
        if (!email) throw new Error('Employee email is required');
        const response = await fetch('/api/invite/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: String(selectedEmployee.id), email, role }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to create invite');
        }
        const inviteUrl = payload?.item?.url;
        if (!inviteUrl || typeof inviteUrl !== 'string') {
          throw new Error('Invalid invite response');
        }
        return inviteUrl;
      };

      const copyText = async (value) => {
        if (!value) throw new Error('Nothing to copy');
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          return;
        }
        const tempInput = document.createElement('textarea');
        tempInput.value = value;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      };

      const handleCopyInviteLink = async () => {
        setInviteFeedback('');
        try {
          const inviteLink = await buildInviteLink();
          await copyText(inviteLink);
          setInviteFeedback('Invite link copied.');
        } catch (error) {
          setInviteFeedback(error instanceof Error ? error.message : 'Failed to copy invite link.');
        }
      };

      const handleCopyInviteMessage = async () => {
        setInviteFeedback('');
        try {
          const { name, role } = getInvitePayload();
          const greeting = name ? `Hi ${name},` : 'Hi,';
          const roleLine = role ? `role: ${role}` : 'role: team member';
          const inviteLink = await buildInviteLink();
          const message = `${greeting}\n\nYou are invited to Groundwork Pro (${roleLine}).\nUse this link to create your account:\n${inviteLink}`;
          await copyText(message);
          setInviteFeedback('Invite message copied.');
        } catch (error) {
          setInviteFeedback(error instanceof Error ? error.message : 'Failed to copy invite message.');
        }
      };

      const openAssignModal = (employee) => {
        setAssignError('');
        setAssignSuccess('');
        setAssignForm({
          employeeId: String(employee.id),
          jobId: '',
          date: new Date().toISOString().slice(0, 10),
          notes: '',
        });
        setShowAssignModal(true);
      };

      const handleAssignSubmit = async (event) => {
        event.preventDefault();
        if (!assignForm.employeeId || !assignForm.jobId || !assignForm.date) {
          setAssignError('Job and date are required.');
          return;
        }

        setAssignLoading(true);
        setAssignError('');
        setAssignSuccess('');

        try {
          const response = await fetch('/api/schedule/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeId: assignForm.employeeId,
              jobId: assignForm.jobId,
              date: assignForm.date,
              notes: assignForm.notes || undefined,
            }),
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.item) {
            setAssignError(payload?.error || 'Failed to create assignment.');
            setAssignLoading(false);
            return;
          }

          setAssignSuccess('Assignment created.');
          await loadTeamItems();
          setShowAssignModal(false);
        } catch {
          setAssignError('Failed to create assignment.');
        } finally {
          setAssignLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          {/* Stats */}
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="users" label="Total Employees" value={stats.total} color="brand" />
            <StatCard icon="user-check" label="On Site Today" value={stats.onSite} color="green" />
            <StatCard icon="hard-hat" label="Foremen" value={teamItems.filter(e => String(e.role).toLowerCase() === 'foreman').length} color="blue" />
            <StatCard icon="id-card" label="Expiring Certs" value={teamItems.flatMap(e => (e.certifications || []).filter(c => getDaysUntil(c.expires) < 60)).length} color="red" />
          </StatGrid>

          {/* Filters */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex bg-gray-100 rounded-lg p-1 overflow-x-auto">
                {['all', 'on-site', 'off'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilter(status)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                      filter === status ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {status === 'on-site' ? 'On Site' : status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="secondary" className="w-full sm:w-auto whitespace-nowrap" onClick={() => setShowModal({ type: 'time-clock' })}>
                <Icon name="clock" className="mr-2" /> Time Clock
              </Button>
              <Button variant="brand" className="w-full sm:w-auto whitespace-nowrap" onClick={handleCreateEmployee} disabled={employeeActionLoading}>
                <Icon name="user-plus" className="mr-2" /> Add Employee
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Employee List */}
            <div className="lg:col-span-2 space-y-3">
              {employeesLoading || teamLoading ? (
                <LoadingBlock testId="team-loading">Loading employees...</LoadingBlock>
              ) : filteredEmployees.length === 0 ? (
                <EmptyState testId="team-empty">No employees yet.</EmptyState>
              ) : filteredEmployees.map(emp => {
                const job = jobs.find(j => j.id === emp.jobId);
                const expiringSoon = (emp.certifications || []).filter(c => getDaysUntil(c.expires) < 60);

                return (
                  <Card
                    key={emp.id}
                    className={`p-4 cursor-pointer transition-all ${selectedEmployeeId === emp.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                    onClick={() => setSelectedEmployeeId(emp.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium ${getContactCircleColor(emp.id || emp.name)}`}>
                        {emp.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{emp.name}</h4>
                          {emp.status === 'active' && emp.clockedInAt && (
                            <span className="text-xs text-green-600 flex items-center gap-1">
                              <span className="w-2 h-2 bg-green-500 rounded-full pulse-dot"></span>
                              Since {formatDate(emp.clockedInAt)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{emp.role}</p>
                        <p className="text-xs text-gray-500">
                          Account: {emp.accountStatus === 'active' ? 'Active' : 'Invite pending'}
                        </p>
                        <p className="text-xs text-gray-500">Hours This Week: {Number(emp.hoursThisWeek || 0).toFixed(1)}</p>
                      </div>
                      <div className="text-right">
                        {canAssignFromTeam && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`team-assign-${emp.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openAssignModal(emp);
                            }}
                          >
                            Assign
                          </Button>
                        )}
                        {emp.assignedToday && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 justify-end">
                            <Icon name="location-dot" className="text-brand-500" />
                            {emp.assignedToday.jobName}
                          </p>
                        )}
                        {expiringSoon.length > 0 && (
                          <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                            <Icon name="triangle-exclamation" />
                            {expiringSoon.length} cert(s) expiring
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Employee Detail */}
            {selectedEmployee ? (
              <Card className="p-4 h-fit sticky top-4 max-h-[calc(100vh-140px)] overflow-y-auto">
                <div className="text-center mb-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-medium mx-auto mb-3 ${getContactCircleColor(selectedEmployee.id || selectedEmployee.name)}`}>
                    {selectedEmployee.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <h3 className="font-semibold text-gray-900">{selectedEmployee.name}</h3>
                  <p className="text-sm text-gray-500">{selectedEmployee.role}</p>
                  <Badge className={`mt-2 ${getStatusColor(selectedEmployee.status)}`}>
                    {selectedEmployee.status === 'active' ? 'On Site' : 'Off'}
                  </Badge>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Name</p>
                    <input
                      type="text"
                      value={employeeForm.name}
                      onChange={(e) => setEmployeeForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      disabled={!canManageTeamProfiles}
                    />
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Role</p>
                    <select
                      value={employeeForm.role}
                      onChange={(e) => setEmployeeForm((prev) => ({ ...prev, role: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      disabled={!canManageTeamProfiles}
                    >
                      <option value="admin">Admin</option>
                      <option value="pm">PM</option>
                      <option value="foreman">Foreman</option>
                      <option value="mechanic">Mechanic</option>
                      <option value="operator">Operator</option>
                      <option value="operator">Laborer</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Phone</p>
                      <input
                        type="text"
                        value={employeeForm.phone}
                        onChange={(e) => setEmployeeForm((prev) => ({ ...prev, phone: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        disabled={!canManageTeamProfiles}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Email</p>
                      <input
                        type="email"
                        value={employeeForm.email}
                        onChange={(e) => setEmployeeForm((prev) => ({ ...prev, email: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        disabled={!canManageTeamProfiles}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Hourly Rate</p>
                      <input
                        type="number"
                        value={employeeForm.hourlyRate}
                        onChange={(e) => setEmployeeForm((prev) => ({ ...prev, hourlyRate: Number(e.target.value) || 0 }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        disabled={!canEditPay}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Status</p>
                      <select
                        value={employeeForm.status}
                        onChange={(e) => setEmployeeForm((prev) => ({ ...prev, status: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        disabled={!canManageTeamProfiles}
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Assigned Job</p>
                    <select
                      value={employeeForm.jobId}
                      onChange={(e) => setEmployeeForm((prev) => ({ ...prev, jobId: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      disabled={!canManageTeamProfiles}
                    >
                      <option value="">Unassigned</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Hours This Week</p>
                    <p className="text-sm font-medium">{Number(selectedEmployee.hoursThisWeek || 0).toFixed(1)} hrs</p>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">Certifications</p>
                    <div className="space-y-2">
                      {selectedEmployeeCertifications.map((cert, i) => {
                        const daysLeft = getDaysUntil(cert.expires);
                        const isExpiring = daysLeft < 60;
                        const isExpired = daysLeft < 0;

                        return (
                          <div key={i} className={`p-2 rounded-lg ${isExpired ? 'bg-red-50' : isExpiring ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{cert.name}</span>
                              <Badge variant={isExpired ? 'danger' : isExpiring ? 'warning' : 'success'}>
                                {isExpired ? 'Expired' : isExpiring ? `${daysLeft}d left` : 'Valid'}
                              </Badge>
                            </div>
                            <p className="text-xs text-gray-500">Expires: {formatDate(cert.expires)}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button variant="secondary" size="sm" className="flex-1">
                      <Icon name="clock-rotate-left" className="mr-1" /> Timesheet
                    </Button>
                    {canManageTeamProfiles && (
                      <Button variant="brand" size="sm" className="flex-1" onClick={handleSaveEmployee} disabled={employeeSaveLoading}>
                        <Icon name="floppy-disk" className="mr-1" /> {employeeSaveLoading ? 'Saving...' : 'Save'}
                      </Button>
                    )}
                  </div>
                  {canManageTeamProfiles && (
                    <div className="pt-2">
                      <Button
                        variant="danger"
                        size="sm"
                        className="w-full"
                        onClick={handleDeleteEmployee}
                        disabled={employeeDeleteLoading || employeeSaveLoading}
                      >
                        <Icon name="trash" className="mr-1" /> {employeeDeleteLoading ? 'Deleting...' : 'Delete Team Member'}
                      </Button>
                    </div>
                  )}
                  {canManageTeamProfiles && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Button variant="secondary" size="sm" onClick={handleCopyInviteLink}>
                        <Icon name="link" className="mr-1" /> Copy Invite Link
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleCopyInviteMessage}>
                        <Icon name="envelope" className="mr-1" /> Copy Invite Message
                      </Button>
                    </div>
                  )}
                  {inviteFeedback && <p className="text-xs text-gray-600">{inviteFeedback}</p>}
                  {employeeActionError && <InlineError>{employeeActionError}</InlineError>}
                  {teamError && <InlineError>{teamError}</InlineError>}
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="user" className="text-4xl mb-2 text-gray-300" />
                <p>Select an employee to view details</p>
              </Card>
            )}

          </div>

          <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign" size="sm">
            <form className="space-y-3" onSubmit={handleAssignSubmit}>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Job</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={assignForm.jobId}
                  onChange={(event) => setAssignForm((prev) => ({ ...prev, jobId: event.target.value }))}
                  data-testid="team-assign-job"
                  required
                >
                  <option value="">Select job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={assignForm.date}
                  onChange={(event) => setAssignForm((prev) => ({ ...prev, date: event.target.value }))}
                  data-testid="team-assign-date"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Notes</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  value={assignForm.notes}
                  onChange={(event) => setAssignForm((prev) => ({ ...prev, notes: event.target.value }))}
                  data-testid="team-assign-notes"
                />
              </div>
              {assignError && <InlineError>{assignError}</InlineError>}
              {assignSuccess && <p className="text-sm text-green-700">{assignSuccess}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAssignModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="brand" size="sm" disabled={assignLoading} data-testid="team-assign-submit">
                  {assignLoading ? 'Assigning...' : 'Assign'}
                </Button>
              </div>
            </form>
          </Modal>
        </div>
      );
    };

    // ============================================
    // MAINTENANCE VIEW
    // ============================================
    const MaintenanceView = ({ workOrders, workOrdersLoading, setWorkOrders, equipment, employees, setShowModal }) => {
      const [filter, setFilter] = useState('all');
      const [selectedWOId, setSelectedWOId] = useState(null);
      const [woStatus, setWoStatus] = useState('scheduled');
      const [woPriority, setWoPriority] = useState('medium');
      const [woActionLoading, setWoActionLoading] = useState(false);
      const [woActionError, setWoActionError] = useState('');

      const normalizeWoStatus = (status) => {
        const value = String(status || '').toLowerCase();
        if (['complete', 'completed', 'closed', 'done'].includes(value)) return 'completed';
        if (value === 'open') return 'scheduled';
        if (value === 'in_progress') return 'in-progress';
        return value || 'scheduled';
      };
      const getWoDisplayStatus = (status) => normalizeWoStatus(status);
      const filteredWOs = workOrders.filter((wo) => {
        const normalizedStatus = normalizeWoStatus(wo.status);
        if (filter === 'all') return true;
        if (filter === 'scheduled') return normalizedStatus === 'scheduled';
        return normalizedStatus === filter;
      });
      const selectedWO = workOrders.find(w => w.id === selectedWOId);
      const selectedEquipment = selectedWO ? equipment.find(e => e.id === selectedWO.equipmentId) : null;
      const assignee = selectedWO ? employees.find(e => e.id === selectedWO.assignedTo) : null;

      const upcomingPM = equipment.filter(e => (e.nextService - e.hours) < 250);

      useEffect(() => {
        if (!selectedWO) return;
        setWoStatus(normalizeWoStatus(selectedWO.status || 'scheduled'));
        setWoPriority(selectedWO.priority || 'medium');
        setWoActionError('');
      }, [selectedWO]);

      const handleSaveWorkOrder = async () => {
        if (!selectedWO) return;
        setWoActionLoading(true);
        setWoActionError('');
        try {
          const updates = {};
          const selectedStatus = normalizeWoStatus(selectedWO.status || 'scheduled');
          if (woStatus !== selectedStatus) updates.status = woStatus;
          if (woPriority !== (selectedWO.priority || 'medium')) updates.priority = woPriority;

          if (Object.keys(updates).length === 0) {
            setWoActionLoading(false);
            return;
          }

          const response = await fetch(`/api/work-orders/${selectedWO.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.workOrder) {
            setWoActionError(payload?.error || raw || 'Failed to update work order');
            setWoActionLoading(false);
            return;
          }

          setWorkOrders((prev) =>
            prev.map((wo) => (String(wo.id) === String(selectedWO.id) ? payload.workOrder : wo))
          );
        } catch {
          setWoActionError('Failed to update work order');
        } finally {
          setWoActionLoading(false);
        }
      };

      const handleDeleteWorkOrder = async () => {
        if (!selectedWO) return;
        const confirmed = confirmDestructiveAction('this work order');
        if (!confirmed) return;
        setWoActionLoading(true);
        setWoActionError('');
        try {
          const response = await fetch(`/api/work-orders/${selectedWO.id}`, {
            method: 'DELETE',
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setWoActionError(payload?.error || raw || 'Failed to delete work order');
            setWoActionLoading(false);
            return;
          }
          setWorkOrders((prev) => prev.filter((wo) => String(wo.id) !== String(selectedWO.id)));
          setSelectedWOId(null);
        } catch {
          setWoActionError('Failed to delete work order');
        } finally {
          setWoActionLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          {/* Stats */}
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="clipboard-list" label="Open Work Orders" value={workOrders.filter(w => normalizeWoStatus(w.status) !== 'completed').length} color="brand" />
            <StatCard icon="circle-exclamation" label="High Priority" value={workOrders.filter(w => w.priority === 'high' && normalizeWoStatus(w.status) !== 'completed').length} color="red" />
            <StatCard icon="calendar-check" label="Scheduled PM" value={workOrders.filter(w => w.type === 'preventive').length} color="blue" />
            <StatCard icon="triangle-exclamation" label="PM Due Soon" value={upcomingPM.length} color="yellow" />
          </StatGrid>

          {/* Filters */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex bg-gray-100 rounded-lg p-1 overflow-x-auto">
                {['all', 'in-progress', 'scheduled', 'completed'].map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                      filter === f ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {f.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="brand" className="w-full sm:w-auto whitespace-nowrap" onClick={() => setShowModal({ type: 'work-order' })}>
              <Icon name="plus" className="mr-2" /> New Work Order
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Work Orders List */}
            <div className="lg:col-span-2 space-y-3">
              {workOrdersLoading ? (
                <LoadingBlock testId="maintenance-loading">Loading work orders...</LoadingBlock>
              ) : filteredWOs.length === 0 ? (
                <EmptyState testId="maintenance-empty">No work orders yet.</EmptyState>
              ) : filteredWOs.map(wo => {
                const eq = equipment.find(e => e.id === wo.equipmentId);
                const tech = employees.find(e => e.id === wo.assignedTo);

                return (
                  <Card
                    key={wo.id}
                    className={`p-4 cursor-pointer transition-all ${selectedWOId === wo.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                    onClick={() => setSelectedWOId(wo.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${
                          wo.type === 'repair' ? 'bg-red-100' : wo.type === 'preventive' ? 'bg-blue-100' : 'bg-yellow-100'
                        }`}>
                          <Icon name={wo.type === 'repair' ? 'screwdriver-wrench' : wo.type === 'preventive' ? 'calendar-check' : 'clipboard-check'} className={`${
                            wo.type === 'repair' ? 'text-red-600' : wo.type === 'preventive' ? 'text-blue-600' : 'text-yellow-600'
                          }`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-gray-900">{wo.title}</h4>
                            <Icon name="circle" className={`text-xs ${getPriorityColor(wo.priority)}`} />
                          </div>
                          <p className="text-sm text-gray-500">{eq?.name}</p>
                        </div>
                      </div>
                      <Badge className={getStatusColor(getWoDisplayStatus(wo.status))}>{getWoDisplayStatus(wo.status)}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mt-3">
                      <span><Icon name="user" className="mr-1" />{tech?.name || 'Unassigned'}</span>
                      <span><Icon name="calendar" className="mr-1" />Due {formatDate(wo.dueDate)}</span>
                    </div>
                  </Card>
                );
              })}

              {/* Upcoming PM Section */}
              <div className="pt-6">
                <h3 className="font-semibold text-gray-900 mb-3">Upcoming Preventive Maintenance</h3>
                <Card className="p-0 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Equipment</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Current Hours</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Service Due</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Hours Until</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {upcomingPM.map(eq => (
                        <tr key={eq.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium">{eq.name}</td>
                          <td className="px-4 py-3 text-sm">{eq.hours.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm">{eq.nextService.toLocaleString()}</td>
                          <td className="px-4 py-3">
                            <Badge variant={(eq.nextService - eq.hours) < 100 ? 'danger' : 'warning'}>
                              {eq.nextService - eq.hours} hrs
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="secondary" size="sm" onClick={() => setShowModal({ type: 'work-order', data: { equipmentId: eq.id, type: 'preventive' } })}>
                              Schedule
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>

            {/* Work Order Detail */}
            {selectedWO ? (
              <Card className="p-4 h-fit sticky top-4">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <Badge className={`mb-2 ${wo => wo.type === 'repair' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>
                      {selectedWO.type}
                    </Badge>
                    <h3 className="font-semibold text-gray-900">{selectedWO.title}</h3>
                  </div>
                  <Badge className={getStatusColor(getWoDisplayStatus(selectedWO.status))}>{getWoDisplayStatus(selectedWO.status)}</Badge>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Equipment</p>
                    <p className="text-sm font-medium">{selectedEquipment?.name}</p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Description</p>
                    <p className="text-sm text-gray-700">{selectedWO.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Priority</p>
                      <select
                        value={woPriority}
                        onChange={(e) => setWoPriority(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Due Date</p>
                      <p className="text-sm font-medium">{formatDate(selectedWO.dueDate)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select
                      value={woStatus}
                      onChange={(e) => setWoStatus(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="scheduled">scheduled</option>
                      <option value="in-progress">in-progress</option>
                      <option value="completed">completed</option>
                    </select>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-1">Assigned To</p>
                    <p className="text-sm font-medium">{assignee?.name || 'Unassigned'}</p>
                  </div>

                  {selectedWO.parts.length > 0 && (
                    <div className="pt-4 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-2">Parts Required</p>
                      <div className="space-y-2">
                        {selectedWO.parts.map((part, i) => (
                          <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                            <span>{part.name} x{part.qty}</span>
                            <span className="font-medium">{formatCurrency(part.cost * part.qty)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-sm font-medium pt-2 border-t">
                          <span>Total Parts</span>
                          <span>{formatCurrency(selectedWO.parts.reduce((sum, p) => sum + (p.cost * p.qty), 0))}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-1">Est. Labor Hours</p>
                    <p className="text-sm font-medium">{selectedWO.laborHours} hours</p>
                  </div>

                  <AttachmentPanel entityType="work_order" entityId={selectedWO.id} />

                  {woActionError && (
                    <InlineError>{woActionError}</InlineError>
                  )}

                  <div className="flex gap-2 pt-4">
                    <Button variant="brand" size="sm" className="flex-1" onClick={handleSaveWorkOrder} disabled={woActionLoading}>
                      <Icon name="check" className="mr-1" /> {woActionLoading ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="danger" size="sm" className="flex-1" onClick={handleDeleteWorkOrder} disabled={woActionLoading}>
                      <Icon name="trash" className="mr-1" /> Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="wrench" className="text-4xl mb-2 text-gray-300" />
                <p>Select a work order to view details</p>
              </Card>
            )}
          </div>
        </div>
      );
    };

    // ============================================
    // REPORTS VIEW (with Charts)
    // ============================================
    const ReportsView = ({ jobs, equipment, employees, dailyReports, dailyReportsLoading, setDailyReports, setShowModal }) => {
      const chartRef = useRef(null);
      const pieChartRef = useRef(null);
      const [activeTab, setActiveTab] = useState('overview');
      const [chartsUnavailable, setChartsUnavailable] = useState(false);
      const [editingReportId, setEditingReportId] = useState(null);
      const [reportActionLoading, setReportActionLoading] = useState(false);
      const [reportActionError, setReportActionError] = useState('');
      const [reportForm, setReportForm] = useState({ jobId: '', date: '', notes: '' });
      const [entriesByReport, setEntriesByReport] = useState({});
      const [entriesLoadingByReport, setEntriesLoadingByReport] = useState({});
      const [entryActionLoadingByReport, setEntryActionLoadingByReport] = useState({});
      const [entryActionErrorByReport, setEntryActionErrorByReport] = useState({});
      const [entryFormByReport, setEntryFormByReport] = useState({});
      const [reportJobFilter, setReportJobFilter] = useState('all');
      const [reportStatusFilter, setReportStatusFilter] = useState('all');
      const [reportSearch, setReportSearch] = useState('');
      const [reportDateFrom, setReportDateFrom] = useState('');
      const [reportDateTo, setReportDateTo] = useState('');
      const [activeReportPreset, setActiveReportPreset] = useState('custom');

      const normalizeJobStatusForReports = (status) => {
        const value = String(status || '').toLowerCase();
        if (['completed', 'complete', 'closed', 'done'].includes(value)) return 'completed';
        return 'active';
      };

      const ensureEntryForm = (reportId) => {
        setEntryFormByReport((prev) => ({
          ...prev,
          [reportId]: prev[reportId] || {
            laborEmployeeId: '',
            laborHours: '',
            equipmentId: '',
            equipmentHours: '',
            materialDescription: '',
            materialQuantity: '',
          },
        }));
      };

      const updateEntryForm = (reportId, updates) => {
        setEntryFormByReport((prev) => ({
          ...prev,
          [reportId]: {
            laborEmployeeId: '',
            laborHours: '',
            equipmentId: '',
            equipmentHours: '',
            materialDescription: '',
            materialQuantity: '',
            ...(prev[reportId] || {}),
            ...updates,
          },
        }));
      };

      const loadReportEntries = useCallback(async (reportId) => {
        if (!reportId) return;
        setEntriesLoadingByReport((prev) => ({ ...prev, [reportId]: true }));
        setEntryActionErrorByReport((prev) => ({ ...prev, [reportId]: '' }));
        try {
          const response = await fetch(`/api/daily-reports/${reportId}/entries`, { cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error || 'Failed to load entries');
          }
          setEntriesByReport((prev) => ({ ...prev, [reportId]: payload.entries || [] }));
          ensureEntryForm(reportId);
        } catch {
          setEntriesByReport((prev) => ({ ...prev, [reportId]: [] }));
        } finally {
          setEntriesLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
        }
      }, []);

      useEffect(() => {
        if (activeTab !== 'daily') return;
        dailyReports.forEach((report) => {
          loadReportEntries(report.id);
        });
      }, [activeTab, dailyReports, loadReportEntries]);

      const createEntry = async (reportId, entryType) => {
        const form = entryFormByReport[reportId] || {};
        let body = null;

        if (entryType === 'labor') {
          if (!form.laborEmployeeId || !form.laborHours) return;
          body = {
            entry_type: 'labor',
            employee_id: form.laborEmployeeId,
            hours: Number(form.laborHours),
          };
        } else if (entryType === 'equipment') {
          if (!form.equipmentId || !form.equipmentHours) return;
          body = {
            entry_type: 'equipment',
            equipment_id: form.equipmentId,
            hours: Number(form.equipmentHours),
          };
        } else if (entryType === 'material') {
          if (!form.materialDescription && !form.materialQuantity) return;
          body = {
            entry_type: 'material',
            description: form.materialDescription,
            ...(form.materialQuantity ? { quantity: Number(form.materialQuantity) } : {}),
          };
        } else {
          if (!form.materialDescription) return;
          body = {
            entry_type: 'note',
            description: form.materialDescription,
          };
        }

        setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: true }));
        setEntryActionErrorByReport((prev) => ({ ...prev, [reportId]: '' }));
        try {
          const response = await fetch(`/api/daily-reports/${reportId}/entries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.entry) {
            setEntryActionErrorByReport((prev) => ({
              ...prev,
              [reportId]: payload?.error || raw || 'Failed to add entry',
            }));
            setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
            return;
          }

          setEntriesByReport((prev) => ({
            ...prev,
            [reportId]: [payload.entry, ...(prev[reportId] || [])],
          }));

          if (entryType === 'labor') updateEntryForm(reportId, { laborEmployeeId: '', laborHours: '' });
          if (entryType === 'equipment') updateEntryForm(reportId, { equipmentId: '', equipmentHours: '' });
          if (entryType === 'material') updateEntryForm(reportId, { materialDescription: '', materialQuantity: '' });
        } catch {
          setEntryActionErrorByReport((prev) => ({ ...prev, [reportId]: 'Failed to add entry' }));
        } finally {
          setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
        }
      };

      const deleteEntry = async (reportId, entryId) => {
        const confirmed = confirmDestructiveAction('this report entry');
        if (!confirmed) return;

        setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: true }));
        setEntryActionErrorByReport((prev) => ({ ...prev, [reportId]: '' }));
        try {
          const response = await fetch(`/api/daily-reports/${reportId}/entries/${entryId}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setEntryActionErrorByReport((prev) => ({
              ...prev,
              [reportId]: payload?.error || raw || 'Failed to delete entry',
            }));
            setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
            return;
          }
          setEntriesByReport((prev) => ({
            ...prev,
            [reportId]: (prev[reportId] || []).filter((entry) => String(entry.id) !== String(entryId)),
          }));
        } catch {
          setEntryActionErrorByReport((prev) => ({ ...prev, [reportId]: 'Failed to delete entry' }));
        } finally {
          setEntryActionLoadingByReport((prev) => ({ ...prev, [reportId]: false }));
        }
      };

      const normalizedSearch = String(reportSearch || '').trim().toLowerCase();
      const filteredJobs = jobs.filter((job) => {
        const normalizedStatus = normalizeJobStatusForReports(job.status);
        const matchesStatus = reportStatusFilter === 'all' || normalizedStatus === reportStatusFilter;
        const matchesJob = reportJobFilter === 'all' || String(job.id) === String(reportJobFilter);
        const matchesSearch =
          !normalizedSearch ||
          String(job.name || '').toLowerCase().includes(normalizedSearch) ||
          String(job.client || '').toLowerCase().includes(normalizedSearch) ||
          String(job.address || '').toLowerCase().includes(normalizedSearch);
        return matchesStatus && matchesJob && matchesSearch;
      });

      const allowedJobIds = new Set(filteredJobs.map((job) => String(job.id)));
      const filteredDailyReports = dailyReports.filter((report) => {
        if (reportJobFilter !== 'all' && String(report.jobId) !== String(reportJobFilter)) return false;
        if (!reportDateFrom && !reportDateTo) return true;
        const reportDate = String(report.date || '').slice(0, 10);
        if (!reportDate) return false;
        if (reportDateFrom && reportDate < reportDateFrom) return false;
        if (reportDateTo && reportDate > reportDateTo) return false;
        return true;
      });

      const filteredEquipment = equipment.filter((item) => {
        if (reportJobFilter === 'all') return true;
        return item.jobId && allowedJobIds.has(String(item.jobId));
      });

      const exportRowsToCsv = (filename, rows) => {
        if (!rows.length) return;
        const headers = Object.keys(rows[0]);
        const lines = [
          headers.join(','),
          ...rows.map((row) =>
            headers
              .map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`)
              .join(',')
          ),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      };

      const applyPreset = useCallback((presetKey) => {
        const now = new Date();
        const toIsoDate = (d) => d.toISOString().slice(0, 10);
        if (presetKey === 'ceo_weekly') {
          const from = new Date(now);
          from.setDate(now.getDate() - 7);
          setReportSearch('');
          setReportJobFilter('all');
          setReportStatusFilter('all');
          setReportDateFrom(toIsoDate(from));
          setReportDateTo(toIsoDate(now));
          setActiveReportPreset('ceo_weekly');
          return;
        }
        if (presetKey === 'ops_review') {
          const from = new Date(now);
          from.setDate(now.getDate() - 14);
          setReportSearch('');
          setReportJobFilter('all');
          setReportStatusFilter('active');
          setReportDateFrom(toIsoDate(from));
          setReportDateTo(toIsoDate(now));
          setActiveReportPreset('ops_review');
          return;
        }
        setActiveReportPreset('custom');
      }, []);

      useEffect(() => {
        if (typeof window === 'undefined') return;
        const saved = window.localStorage.getItem('reports.defaultPreset');
        if (saved === 'ceo_weekly' || saved === 'ops_review') {
          applyPreset(saved);
        }
      }, [applyPreset]);

      const saveDefaultPreset = () => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('reports.defaultPreset', activeReportPreset === 'custom' ? 'ceo_weekly' : activeReportPreset);
      };

      const clearDefaultPreset = () => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem('reports.defaultPreset');
      };

      useEffect(() => {
        let revenueChart = null;
        let utilizationChart = null;
        let cancelled = false;

        const setupCharts = async () => {
          try {
            const chartModule = await import('chart.js/auto');
            const Chart = chartModule.default;

            if (cancelled) return;
            setChartsUnavailable(false);

            if (chartRef.current) {
              const ctx = chartRef.current.getContext('2d');
              if (ctx) {
                const existingChart = Chart.getChart(ctx);
                if (existingChart) existingChart.destroy();

                revenueChart = new Chart(ctx, {
                  type: 'bar',
                  data: {
                    labels: filteredJobs.filter(j => j.status !== 'bidding').map(j => j.name.split(' ').slice(0, 2).join(' ')),
                    datasets: [
                      { label: 'Budget', data: filteredJobs.filter(j => j.status !== 'bidding').map(j => j.budget), backgroundColor: '#e5e7eb' },
                      { label: 'Spent', data: filteredJobs.filter(j => j.status !== 'bidding').map(j => j.spent), backgroundColor: '#f97316' },
                    ]
                  },
                  options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                    scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + (v / 1000) + 'k' } } }
                  }
                });
              }
            }

            if (pieChartRef.current) {
              const ctx = pieChartRef.current.getContext('2d');
              if (ctx) {
                const existingChart = Chart.getChart(ctx);
                if (existingChart) existingChart.destroy();

                utilizationChart = new Chart(ctx, {
                  type: 'doughnut',
                  data: {
                    labels: ['Active', 'Idle', 'Maintenance'],
                    datasets: [{
                      data: [
                        filteredEquipment.filter(e => e.status === 'active').length,
                        filteredEquipment.filter(e => e.status === 'idle').length,
                        filteredEquipment.filter(e => e.status === 'maintenance').length,
                      ],
                      backgroundColor: ['#22c55e', '#eab308', '#ef4444'],
                    }]
                  },
                  options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                  }
                });
              }
            }
          } catch {
            if (!cancelled) {
              setChartsUnavailable(true);
            }
          }
        };

        setupCharts();

        return () => {
          cancelled = true;
          if (revenueChart) revenueChart.destroy();
          if (utilizationChart) utilizationChart.destroy();
        };
      }, [filteredJobs, filteredEquipment]);

      return (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
              <div className="xl:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Search</label>
                <input
                  type="text"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Job, client, address"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Job</label>
                <select value={reportJobFilter} onChange={(e) => setReportJobFilter(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="all">All Jobs</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Status</label>
                <select value={reportStatusFilter} onChange={(e) => setReportStatusFilter(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                As of {new Date().toLocaleString()} • Jobs: {filteredJobs.length} • Reports: {filteredDailyReports.length} • Equipment: {filteredEquipment.length}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={activeReportPreset === 'ceo_weekly' ? 'brand' : 'secondary'}
                  size="sm"
                  onClick={() => applyPreset('ceo_weekly')}
                >
                  CEO Weekly
                </Button>
                <Button
                  variant={activeReportPreset === 'ops_review' ? 'brand' : 'secondary'}
                  size="sm"
                  onClick={() => applyPreset('ops_review')}
                >
                  Ops Review
                </Button>
                <Button variant="secondary" size="sm" onClick={saveDefaultPreset}>
                  Save Default
                </Button>
                <Button variant="secondary" size="sm" onClick={clearDefaultPreset}>
                  Reset Default
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    exportRowsToCsv('jobs-report.csv', filteredJobs.map((job) => ({
                      id: job.id,
                      name: job.name,
                      client: job.client || '',
                      status: normalizeJobStatusForReports(job.status),
                      budget: Number(job.budget || 0),
                      spent: Number(job.spent || 0),
                    })))
                  }
                >
                  <Icon name="file-export" className="mr-2" />
                  Export Jobs
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    exportRowsToCsv('daily-reports.csv', filteredDailyReports.map((report) => ({
                      id: report.id,
                      job_id: report.jobId,
                      date: report.date || '',
                      notes: report.notes || '',
                    })))
                  }
                >
                  <Icon name="file-export" className="mr-2" />
                  Export Daily
                </Button>
              </div>
            </div>
          </Card>

          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview', icon: 'chart-line' },
              { id: 'daily', label: 'Daily Reports', icon: 'file-lines', count: filteredDailyReports.length },
              { id: 'labor', label: 'Labor', icon: 'users' },
              { id: 'equipment', label: 'Equipment', icon: 'truck-monster' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">Budget vs Spent by Job</h3>
                  <div className="h-64">
                    {chartsUnavailable ? (
                      <div className="h-full rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-sm text-gray-500">
                        Chart unavailable
                      </div>
                    ) : (
                      <canvas ref={chartRef}></canvas>
                    )}
                  </div>
                </Card>
                <Card className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-4">Fleet Utilization</h3>
                  <div className="h-64">
                    {chartsUnavailable ? (
                      <div className="h-full rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-sm text-gray-500">
                        Chart unavailable
                      </div>
                    ) : (
                      <canvas ref={pieChartRef}></canvas>
                    )}
                  </div>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Total Contract Value</h4>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(filteredJobs.reduce((s, j) => s + j.budget, 0))}</p>
                  <p className="text-sm text-green-600 mt-1">+15% from last month</p>
                </Card>
                <Card className="p-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Total Spent YTD</h4>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(filteredJobs.reduce((s, j) => s + j.spent, 0))}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {filteredJobs.reduce((s, j) => s + Number(j.budget || 0), 0) > 0
                      ? `${Math.round((filteredJobs.reduce((s, j) => s + Number(j.spent || 0), 0) / filteredJobs.reduce((s, j) => s + Number(j.budget || 0), 0)) * 100)}% of budget`
                      : '0% of budget'}
                  </p>
                </Card>
                <Card className="p-4">
                  <h4 className="text-sm font-medium text-gray-500 mb-2">Projected Profit</h4>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(filteredJobs.reduce((s, j) => s + (j.budget - j.spent), 0))}</p>
                  <p className="text-sm text-gray-500 mt-1">Across {filteredJobs.filter(j => normalizeJobStatusForReports(j.status) === 'active').length} active jobs</p>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'daily' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="brand" size="sm" onClick={() => setShowModal({ type: 'daily-report' })}>
                  <Icon name="plus" className="mr-2" /> New Report
                </Button>
              </div>
              {dailyReportsLoading ? (
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Loading daily reports...</p>
                </Card>
              ) : filteredDailyReports.length === 0 ? (
                <Card className="p-4">
                  <p className="text-sm text-gray-500 mb-3">No daily reports yet.</p>
                  <Button variant="secondary" size="sm" onClick={() => setShowModal({ type: 'daily-report' })}>
                    Create your first report
                  </Button>
                </Card>
              ) : filteredDailyReports.map(report => {
                const job = jobs.find(j => j.id === report.jobId);
                const submitter = employees.find(e => e.id === report.submittedBy);
                const isEditing = editingReportId === report.id;
                const reportEntries = entriesByReport[report.id] || [];
                const form = entryFormByReport[report.id] || {
                  laborEmployeeId: '',
                  laborHours: '',
                  equipmentId: '',
                  equipmentHours: '',
                  materialDescription: '',
                  materialQuantity: '',
                };
                const laborEntries = reportEntries.filter((entry) => entry.entry_type === 'labor');
                const equipmentEntries = reportEntries.filter((entry) => entry.entry_type === 'equipment');
                const materialEntries = reportEntries.filter((entry) => entry.entry_type === 'material' || entry.entry_type === 'note');

                const startEdit = () => {
                  setEditingReportId(report.id);
                  setReportForm({
                    jobId: report.jobId ? String(report.jobId) : '',
                    date: report.date || '',
                    notes: report.notes || report.workAccomplished || '',
                  });
                  setReportActionError('');
                };

                const cancelEdit = () => {
                  setEditingReportId(null);
                  setReportActionError('');
                };

                const saveReport = async () => {
                  setReportActionLoading(true);
                  setReportActionError('');
                  try {
                    const response = await fetch(`/api/daily-reports/${report.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        jobId: reportForm.jobId ? Number(reportForm.jobId) || reportForm.jobId : null,
                        date: reportForm.date,
                        notes: reportForm.notes,
                        workAccomplished: reportForm.notes,
                      }),
                    });
                    const raw = await response.text();
                    let payload = null;
                    try {
                      payload = raw ? JSON.parse(raw) : null;
                    } catch {
                      payload = null;
                    }
                    if (!response.ok || !payload?.dailyReport) {
                      setReportActionError(payload?.error || raw || 'Failed to update report');
                      setReportActionLoading(false);
                      return;
                    }
                    setDailyReports((prev) => prev.map((item) => (item.id === report.id ? payload.dailyReport : item)));
                    setEditingReportId(null);
                  } catch {
                    setReportActionError('Failed to update report');
                  } finally {
                    setReportActionLoading(false);
                  }
                };

                const deleteReport = async () => {
                  const confirmed = confirmDestructiveAction('this daily report');
                  if (!confirmed) return;
                  setReportActionLoading(true);
                  setReportActionError('');
                  try {
                    const response = await fetch(`/api/daily-reports/${report.id}`, { method: 'DELETE' });
                    const raw = await response.text();
                    let payload = null;
                    try {
                      payload = raw ? JSON.parse(raw) : null;
                    } catch {
                      payload = null;
                    }
                    if (!response.ok || !payload?.success) {
                      setReportActionError(payload?.error || raw || 'Failed to delete report');
                      setReportActionLoading(false);
                      return;
                    }
                    setDailyReports((prev) => prev.filter((item) => item.id !== report.id));
                    if (editingReportId === report.id) {
                      setEditingReportId(null);
                    }
                  } catch {
                    setReportActionError('Failed to delete report');
                  } finally {
                    setReportActionLoading(false);
                  }
                };

                return (
                  <Card key={report.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-gray-900">{job?.name}</h4>
                        <p className="text-sm text-gray-500">{formatDate(report.date)} • Submitted by {submitter?.name}</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="text-gray-500">{report.weather} • {report.tempHigh}°/{report.tempLow}°</p>
                        <p className="text-gray-500">Crew: {report.crewSize}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {isEditing ? (
                        <>
                          <Button variant="brand" size="sm" onClick={saveReport} disabled={reportActionLoading}>
                            {reportActionLoading ? 'Saving...' : 'Save'}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={reportActionLoading}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="secondary" size="sm" onClick={startEdit} disabled={reportActionLoading}>
                            Edit
                          </Button>
                          <Button variant="danger" size="sm" onClick={deleteReport} disabled={reportActionLoading}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                    {isEditing && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Job</label>
                          <select
                            value={reportForm.jobId}
                            onChange={(e) => setReportForm((prev) => ({ ...prev, jobId: e.target.value }))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="">Select Job</option>
                            {jobs.map(jobOption => <option key={jobOption.id} value={jobOption.id}>{jobOption.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Date</label>
                          <input
                            type="date"
                            value={reportForm.date}
                            onChange={(e) => setReportForm((prev) => ({ ...prev, date: e.target.value }))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="md:col-span-1">
                          <label className="block text-xs text-gray-500 mb-1">Notes</label>
                          <input
                            type="text"
                            value={reportForm.notes}
                            onChange={(e) => setReportForm((prev) => ({ ...prev, notes: e.target.value }))}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                    )}
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Work Accomplished</p>
                        <p className="text-sm text-gray-700">{report.workAccomplished}</p>
                      </div>
                      {report.materialsUsed.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Materials Used</p>
                          <div className="flex flex-wrap gap-2">
                            {report.materialsUsed.map((m, i) => (
                              <Badge key={i} variant="info">{m.item}: {m.qty} {m.unit}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {report.issues && report.issues !== 'None' && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Issues</p>
                          <p className="text-sm text-red-600">{report.issues}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-600 mb-2">Labor</p>
                        <div className="flex gap-2 mb-2">
                          <select
                            value={form.laborEmployeeId}
                            onChange={(e) => updateEntryForm(report.id, { laborEmployeeId: e.target.value })}
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            <option value="">Employee</option>
                            {employees.map((employee) => (
                              <option key={employee.id} value={employee.id}>{employee.name}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={form.laborHours}
                            onChange={(e) => updateEntryForm(report.id, { laborHours: e.target.value })}
                            placeholder="Hours"
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <Button variant="secondary" size="sm" onClick={() => createEntry(report.id, 'labor')} disabled={entryActionLoadingByReport[report.id]}>
                            Add
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {laborEntries.map((entry) => {
                            const employee = employees.find((item) => String(item.id) === String(entry.employee_id));
                            return (
                              <div key={entry.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                                <span>{employee?.name || 'Employee'} ({entry.hours || 0}h)</span>
                                <button type="button" onClick={() => deleteEntry(report.id, entry.id)} className="text-red-600">Delete</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-600 mb-2">Equipment</p>
                        <div className="flex gap-2 mb-2">
                          <select
                            value={form.equipmentId}
                            onChange={(e) => updateEntryForm(report.id, { equipmentId: e.target.value })}
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          >
                            <option value="">Equipment</option>
                            {equipment.map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={form.equipmentHours}
                            onChange={(e) => updateEntryForm(report.id, { equipmentHours: e.target.value })}
                            placeholder="Hours"
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <Button variant="secondary" size="sm" onClick={() => createEntry(report.id, 'equipment')} disabled={entryActionLoadingByReport[report.id]}>
                            Add
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {equipmentEntries.map((entry) => {
                            const item = equipment.find((eq) => String(eq.id) === String(entry.equipment_id));
                            return (
                              <div key={entry.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                                <span>{item?.name || 'Equipment'} ({entry.hours || 0}h)</span>
                                <button type="button" onClick={() => deleteEntry(report.id, entry.id)} className="text-red-600">Delete</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-600 mb-2">Materials / Notes</p>
                        <div className="flex gap-2 mb-2">
                          <input
                            type="text"
                            value={form.materialDescription}
                            onChange={(e) => updateEntryForm(report.id, { materialDescription: e.target.value })}
                            placeholder="Description"
                            className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={form.materialQuantity}
                            onChange={(e) => updateEntryForm(report.id, { materialQuantity: e.target.value })}
                            placeholder="Qty"
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <Button variant="secondary" size="sm" onClick={() => createEntry(report.id, 'material')} disabled={entryActionLoadingByReport[report.id]}>
                            Add Material
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => createEntry(report.id, 'note')} disabled={entryActionLoadingByReport[report.id]}>
                            Add Note
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {materialEntries.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                              <span>
                                {entry.entry_type === 'note' ? 'Note: ' : ''}
                                {entry.description}
                                {entry.entry_type === 'material' ? ` (${entry.quantity || 0})` : ''}
                              </span>
                              <button type="button" onClick={() => deleteEntry(report.id, entry.id)} className="text-red-600">Delete</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {entriesLoadingByReport[report.id] && <p className="text-xs text-gray-400 mt-2">Loading entries...</p>}
                    {entryActionErrorByReport[report.id] && <p className="text-sm text-red-600 mt-2">{entryActionErrorByReport[report.id]}</p>}
                    <AttachmentPanel entityType="daily_report" entityId={report.id} />
                    {reportActionError && isEditing && (
                      <p className="text-sm text-red-600 mt-3">{reportActionError}</p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {activeTab === 'labor' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Labor Summary</h3>
              <Table
                columns={[
                  { header: 'Employee', render: (row) => <span className="font-medium">{row.name}</span> },
                  { header: 'Role', key: 'role' },
                  { header: 'Rate', render: (row) => `$${row.hourlyRate}/hr` },
                  { header: 'Status', render: (row) => <Badge className={getStatusColor(row.status)}>{row.status}</Badge> },
                  { header: 'Current Job', render: (row) => jobs.find(j => j.id === row.jobId)?.name || '-' },
                ]}
                data={employees}
              />
            </Card>
          )}

          {activeTab === 'equipment' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">Equipment Summary</h3>
              <Table
                columns={[
                  { header: 'Equipment', render: (row) => <span className="font-medium">{row.name}</span> },
                  { header: 'Type', key: 'type' },
                  { header: 'Hours', render: (row) => row.hours.toLocaleString() },
                  { header: 'Status', render: (row) => <Badge className={getStatusColor(row.status)}>{row.status}</Badge> },
                  { header: 'Daily Rate', render: (row) => formatCurrency(row.dailyRate) },
                  { header: 'Assignment', render: (row) => jobs.find(j => j.id === row.jobId)?.name || 'Unassigned' },
                ]}
                data={filteredEquipment}
              />
            </Card>
          )}
        </div>
      );
    };

    // ============================================
    // JOB COSTING VIEW
    // ============================================
    const JobCostingView = ({ jobs, costCodes, costCodesLoading, setCostCodes }) => {
      const [selectedJobId, setSelectedJobId] = useState(jobs.find(j => j.status === 'active')?.id || jobs[0]?.id || '');
      const [showCostCodeModal, setShowCostCodeModal] = useState(false);
      const [editingCostCodeId, setEditingCostCodeId] = useState(null);
      const [saveLoading, setSaveLoading] = useState(false);
      const [deleteLoadingId, setDeleteLoadingId] = useState(null);
      const [costCodeError, setCostCodeError] = useState('');
      const [costSummary, setCostSummary] = useState(null);
      const [costSummaryLoading, setCostSummaryLoading] = useState(false);
      const [costSummaryError, setCostSummaryError] = useState('');
      const [costCodeForm, setCostCodeForm] = useState({
        code: '',
        name: '',
        status: 'active',
        budgeted: 0,
      });

      const selectedJob = jobs.find(j => String(j.id) === String(selectedJobId));

      const costData = costCodes.map(cc => {
        const actual = Math.round(Number(cc.budgeted || 0) * 0.65);
        return {
          ...cc,
          actual,
          variance: Number(cc.budgeted || 0) - actual,
        };
      });

      const totalBudget = costData.reduce((s, c) => s + Number(c.budgeted || 0), 0);
      const totalActual = costData.reduce((s, c) => s + Number(c.actual || 0), 0);
      const totalVariance = totalBudget - totalActual;
      const rollupEstimated = Number(costSummary?.estimatedCost || totalBudget);
      const rollupActual = Number(costSummary?.actualCost || totalActual);
      const rollupVariance = Number(costSummary?.varianceAmount ?? (rollupActual - rollupEstimated));

      useEffect(() => {
        let isMounted = true;
        const loadCostSummary = async () => {
          if (!selectedJobId) {
            if (isMounted) setCostSummary(null);
            return;
          }
          try {
            setCostSummaryLoading(true);
            setCostSummaryError('');
            const response = await fetch(`/api/jobs/${selectedJobId}/cost-summary`, { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Failed to load cost summary');
            if (isMounted) setCostSummary(payload.item || null);
          } catch (error) {
            if (isMounted) {
              setCostSummary(null);
              setCostSummaryError(error instanceof Error ? error.message : 'Failed to load cost summary');
            }
          } finally {
            if (isMounted) setCostSummaryLoading(false);
          }
        };
        loadCostSummary();
        return () => {
          isMounted = false;
        };
      }, [selectedJobId]);

      const openCreateModal = () => {
        setEditingCostCodeId(null);
        setCostCodeError('');
        setCostCodeForm({
          code: '',
          name: '',
          status: 'active',
          budgeted: 0,
        });
        setShowCostCodeModal(true);
      };

      const openEditModal = (item) => {
        setEditingCostCodeId(item.id);
        setCostCodeError('');
        setCostCodeForm({
          code: item.code || '',
          name: item.name || item.description || '',
          status: item.status || 'active',
          budgeted: Number(item.budgeted || 0),
        });
        setShowCostCodeModal(true);
      };

      const closeModal = () => {
        setShowCostCodeModal(false);
        setEditingCostCodeId(null);
        setCostCodeError('');
      };

      const handleSaveCostCode = async () => {
        if (!costCodeForm.code.trim() || !costCodeForm.name.trim()) {
          setCostCodeError('Code and name are required');
          return;
        }

        setSaveLoading(true);
        setCostCodeError('');
        try {
          const response = await fetch(editingCostCodeId ? `/api/cost-codes/${editingCostCodeId}` : '/api/cost-codes', {
            method: editingCostCodeId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: costCodeForm.code,
              name: costCodeForm.name,
              status: costCodeForm.status,
              budgeted: Number(costCodeForm.budgeted || 0),
            }),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.cost_code) {
            setCostCodeError(payload?.error || raw || 'Failed to save cost code');
            setSaveLoading(false);
            return;
          }

          setCostCodes((prev) => {
            if (editingCostCodeId) {
              return prev.map((row) => (String(row.id) === String(editingCostCodeId) ? payload.cost_code : row));
            }
            return [...prev, payload.cost_code].sort((a, b) => String(a.code).localeCompare(String(b.code)));
          });

          closeModal();
        } catch {
          setCostCodeError('Failed to save cost code');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleDeleteCostCode = async (id) => {
        const confirmed = confirmDestructiveAction('this cost code');
        if (!confirmed) return;

        setDeleteLoadingId(id);
        setCostCodeError('');
        try {
          const response = await fetch(`/api/cost-codes/${id}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.success) {
            setCostCodeError(payload?.error || raw || 'Failed to delete cost code');
            setDeleteLoadingId(null);
            return;
          }

          setCostCodes((prev) => prev.filter((row) => String(row.id) !== String(id)));
        } catch {
          setCostCodeError('Failed to delete cost code');
        } finally {
          setDeleteLoadingId(null);
        }
      };

      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-gray-700">Select Job:</label>
              <select
                value={selectedJobId || ''}
                onChange={(e) => setSelectedJobId(e.target.value)}
                className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {jobs.filter(j => j.status !== 'bidding').map(job => (
                  <option key={job.id} value={job.id}>{job.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">
                <Icon name="file-export" className="mr-2" /> Export
              </Button>
              <Button variant="brand" onClick={openCreateModal}>
                <Icon name="plus" className="mr-2" /> Add Cost Entry
              </Button>
            </div>
          </div>

          {selectedJob && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Contract Value</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(selectedJob.budget)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Estimated Cost</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(rollupEstimated)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Actual Cost</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(rollupActual)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Variance</p>
                  <p className={`text-2xl font-bold ${rollupVariance <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {rollupVariance >= 0 ? '+' : ''}{formatCurrency(rollupVariance)}
                  </p>
                </Card>
              </div>

              {costSummaryLoading && <p className="text-sm text-gray-500">Loading cost rollup...</p>}
              {costSummaryError && <p className="text-sm text-red-600">{costSummaryError}</p>}
              {costSummary?.isOverBudget && (
                <Card className="p-4 border-red-200 bg-red-50">
                  <p className="text-sm font-semibold text-red-700">Margin drift detected</p>
                  <p className="text-sm text-red-600 mt-1">
                    Actual cost is {Number(costSummary.variancePercent || 0).toFixed(2)}% over estimate.
                  </p>
                </Card>
              )}

              <Card className="p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Cost Code Breakdown</h3>
                </div>
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Budgeted</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actual</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">% Used</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {costCodesLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-sm text-gray-500" colSpan={7}>Loading cost codes...</td>
                      </tr>
                    ) : costData.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-sm text-gray-500" colSpan={7}>No cost codes yet.</td>
                      </tr>
                    ) : costData.map((cc) => {
                      const pctUsed = cc.budgeted > 0 ? Math.round((cc.actual / cc.budgeted) * 100) : 0;
                      return (
                        <tr key={cc.id || cc.code} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-mono text-gray-600">{cc.code}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{cc.name || cc.description}</td>
                          <td className="px-4 py-3 text-sm text-right">{formatCurrency(cc.budgeted)}</td>
                          <td className="px-4 py-3 text-sm text-right">{formatCurrency(cc.actual)}</td>
                          <td className={`px-4 py-3 text-sm text-right font-medium ${cc.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {cc.variance >= 0 ? '+' : ''}{formatCurrency(cc.variance)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-24">
                                <ProgressBar value={pctUsed} color={pctUsed > 100 ? 'red' : pctUsed > 80 ? 'yellow' : 'green'} size="sm" />
                              </div>
                              <span className="text-xs text-gray-500 w-10">{pctUsed}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button variant="secondary" size="sm" onClick={() => openEditModal(cc)}>
                              <Icon name="pen-to-square" />
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleDeleteCostCode(cc.id)}
                              disabled={deleteLoadingId === cc.id}
                            >
                              <Icon name={deleteLoadingId === cc.id ? 'spinner' : 'trash'} className={deleteLoadingId === cc.id ? 'animate-spin' : ''} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td className="px-4 py-3 text-sm" colSpan="2">Total</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(totalBudget)}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(totalActual)}</td>
                      <td className={`px-4 py-3 text-sm text-right ${totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance)}
                      </td>
                      <td className="px-4 py-3 text-sm">{totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0}%</td>
                      <td className="px-4 py-3 text-sm"></td>
                    </tr>
                  </tfoot>
                </table>
              </Card>

              {costCodeError && <p className="text-sm text-red-600">{costCodeError}</p>}
            </>
          )}

          {showCostCodeModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeModal} aria-label="Close cost code modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{editingCostCodeId ? 'Edit Cost Code' : 'Add Cost Code'}</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={closeModal}>
                    <Icon name="xmark" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Code</p>
                    <input type="text" value={costCodeForm.code} onChange={(e) => setCostCodeForm({ ...costCodeForm, code: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select value={costCodeForm.status} onChange={(e) => setCostCodeForm({ ...costCodeForm, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                      <option value="archived">archived</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Name</p>
                    <input type="text" value={costCodeForm.name} onChange={(e) => setCostCodeForm({ ...costCodeForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Budgeted</p>
                    <input type="number" min="0" step="1" value={costCodeForm.budgeted} onChange={(e) => setCostCodeForm({ ...costCodeForm, budgeted: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>

                {costCodeError && <p className="text-sm text-red-600 mt-4">{costCodeError}</p>}

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={closeModal}>Cancel</Button>
                  <Button variant="brand" onClick={handleSaveCostCode} disabled={saveLoading}>
                    <Icon name={saveLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${saveLoading ? 'animate-spin' : ''}`} />
                    {editingCostCodeId ? 'Save Cost Code' : 'Create Cost Code'}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // SAFETY VIEW
    // ============================================
    const SafetyView = ({
      employees,
      setShowModal,
      safetyLogs,
      safetyLogsLoading,
      safetyLogsError,
      onDeleteSafetyLog,
      deleteLoadingId,
    }) => {
      const [deleteError, setDeleteError] = useState('');
      const [summary, setSummary] = useState({ openHazards: 0, overdueActions: 0, highSeverity7d: 0, closedThisWeek: 0 });
      const [summaryLoading, setSummaryLoading] = useState(true);
      const [actions, setActions] = useState([]);
      const [actionsLoading, setActionsLoading] = useState(true);
      const [actionsError, setActionsError] = useState('');
      const [toolboxTalks, setToolboxTalks] = useState([]);
      const [toolboxLoading, setToolboxLoading] = useState(true);
      const [toolboxError, setToolboxError] = useState('');
      const [newAction, setNewAction] = useState({ safety_log_id: '', title: '', owner_employee_id: '', due_date: '', priority: 'medium' });
      const [newTalk, setNewTalk] = useState({ topic: '', summary: '', occurred_on: new Date().toISOString().slice(0, 10), attendee_employee_ids: [] });
      const [submitLoading, setSubmitLoading] = useState(false);

      const loadSafetySummary = useCallback(async () => {
        try {
          setSummaryLoading(true);
          const response = await fetch('/api/safety/summary', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to load summary');
          setSummary(payload.item || { openHazards: 0, overdueActions: 0, highSeverity7d: 0, closedThisWeek: 0 });
        } catch {
          setSummary({ openHazards: 0, overdueActions: 0, highSeverity7d: 0, closedThisWeek: 0 });
        } finally {
          setSummaryLoading(false);
        }
      }, []);

      const loadSafetyActions = useCallback(async () => {
        try {
          setActionsLoading(true);
          setActionsError('');
          const response = await fetch('/api/safety-actions?status=all&limit=50', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to load actions');
          setActions(payload.items || []);
        } catch (error) {
          setActions([]);
          setActionsError(error instanceof Error ? error.message : 'Failed to load actions');
        } finally {
          setActionsLoading(false);
        }
      }, []);

      const loadToolboxTalks = useCallback(async () => {
        try {
          setToolboxLoading(true);
          setToolboxError('');
          const response = await fetch('/api/toolbox-talks?limit=50', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to load toolbox talks');
          setToolboxTalks(payload.items || []);
        } catch (error) {
          setToolboxTalks([]);
          setToolboxError(error instanceof Error ? error.message : 'Failed to load toolbox talks');
        } finally {
          setToolboxLoading(false);
        }
      }, []);

      useEffect(() => {
        loadSafetySummary();
        loadSafetyActions();
        loadToolboxTalks();
      }, [loadSafetyActions, loadSafetySummary, loadToolboxTalks]);

      useEffect(() => {
        if (safetyLogs.length > 0 && !newAction.safety_log_id) {
          setNewAction((prev) => ({ ...prev, safety_log_id: String(safetyLogs[0].id) }));
        }
      }, [newAction.safety_log_id, safetyLogs]);
      const expiringCerts = employees.flatMap(emp =>
        emp.certifications.filter(c => getDaysUntil(c.expires) < 90).map(c => ({
          ...c,
          employeeId: emp.id,
          employeeName: emp.name,
          daysLeft: getDaysUntil(c.expires),
        }))
      ).sort((a, b) => a.daysLeft - b.daysLeft);

      const safetyStats = {
        total: safetyLogs.length,
        high: summary.highSeverity7d,
      };

      const severityVisuals = {
        low: {
          iconBg: 'bg-green-100',
          iconColor: 'text-green-600',
          icon: 'circle-check',
          label: 'Low',
        },
        medium: {
          iconBg: 'bg-yellow-100',
          iconColor: 'text-yellow-600',
          icon: 'triangle-exclamation',
          label: 'Medium',
        },
        high: {
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          icon: 'circle-exclamation',
          label: 'High',
        },
      };

      const handleDeleteClick = async (id) => {
        setDeleteError('');
        const result = await onDeleteSafetyLog(id);
        if (!result?.ok) {
          setDeleteError(result?.error || 'Failed to delete safety log');
        } else {
          await Promise.all([loadSafetySummary(), loadSafetyActions()]);
        }
      };

      const handleCreateAction = async () => {
        const resolvedSafetyLogId = newAction.safety_log_id || (safetyLogs[0]?.id ? String(safetyLogs[0].id) : '');
        if (!resolvedSafetyLogId || !newAction.title.trim()) {
          setActionsError('Action title and related log are required');
          return;
        }
        try {
          setSubmitLoading(true);
          setActionsError('');
          const response = await fetch('/api/safety-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              safety_log_id: resolvedSafetyLogId,
              title: newAction.title.trim(),
              owner_employee_id: newAction.owner_employee_id || null,
              due_date: newAction.due_date || null,
              priority: newAction.priority,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to create action');
          setNewAction((prev) => ({
            ...prev,
            safety_log_id: resolvedSafetyLogId,
            title: '',
            owner_employee_id: '',
            due_date: '',
          }));
          await Promise.all([loadSafetyActions(), loadSafetySummary()]);
        } catch (error) {
          setActionsError(error instanceof Error ? error.message : 'Failed to create action');
        } finally {
          setSubmitLoading(false);
        }
      };

      const handleCloseAction = async (actionId) => {
        try {
          const response = await fetch(`/api/safety-actions/${actionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'closed' }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to close action');
          await Promise.all([loadSafetyActions(), loadSafetySummary()]);
        } catch (error) {
          setActionsError(error instanceof Error ? error.message : 'Failed to close action');
        }
      };

      const handleCreateToolboxTalk = async () => {
        if (!newTalk.topic.trim()) {
          setToolboxError('Topic is required');
          return;
        }
        try {
          setSubmitLoading(true);
          setToolboxError('');
          const response = await fetch('/api/toolbox-talks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              topic: newTalk.topic.trim(),
              summary: newTalk.summary.trim(),
              occurred_on: newTalk.occurred_on,
              attendee_employee_ids: newTalk.attendee_employee_ids,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error || 'Failed to create toolbox talk');
          setNewTalk({ topic: '', summary: '', occurred_on: new Date().toISOString().slice(0, 10), attendee_employee_ids: [] });
          await loadToolboxTalks();
        } catch (error) {
          setToolboxError(error instanceof Error ? error.message : 'Failed to create toolbox talk');
        } finally {
          setSubmitLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          {/* Stats */}
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="shield-halved" label="Safety Logs (30d)" value={safetyStats.total} color="green" />
            <StatCard icon="triangle-exclamation" label="High Severity (7d)" value={summaryLoading ? '…' : safetyStats.high} color="red" />
            <StatCard icon="clipboard-check" label="Open Hazards" value={summaryLoading ? '…' : summary.openHazards} color="yellow" />
            <StatCard icon="calendar-xmark" label="Overdue Actions" value={summaryLoading ? '…' : summary.overdueActions} color="red" />
          </StatGrid>

          <div className="flex justify-end">
            <Button variant="brand" onClick={() => setShowModal({ type: 'safety' })} data-testid="safety-open-create">
              <Icon name="plus" className="mr-2" /> New Safety Log
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Safety Logs */}
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Recent Safety Logs</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {safetyLogsLoading ? (
                  <LoadingBlock testId="safety-loading">Loading safety logs...</LoadingBlock>
                ) : safetyLogsError ? (
                  <InlineError testId="safety-error">{safetyLogsError}</InlineError>
                ) : safetyLogs.length === 0 ? (
                  <EmptyState testId="safety-empty">No safety logs yet.</EmptyState>
                ) : safetyLogs.map((log) => {
                  const severity = severityVisuals[log.severity] || severityVisuals.medium;
                  const isDeleting = String(deleteLoadingId) === String(log.id);
                  return (
                    <div key={log.id} className="p-4 hover:bg-gray-50" data-testid={`safety-log-row-${log.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`p-2 rounded-lg ${severity.iconBg}`}>
                            <Icon name={severity.icon} className={severity.iconColor} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 break-words">{log.summary}</p>
                            <p className="text-sm text-gray-500">{severity.label} Severity</p>
                          </div>
                        </div>
                        <div className="text-right text-sm text-gray-500 shrink-0">
                          <p>{formatDate(log.occurred_on)}</p>
                          <button
                            type="button"
                            className="mt-2 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                            onClick={() => handleDeleteClick(log.id)}
                            disabled={isDeleting}
                            data-testid={`safety-delete-${log.id}`}
                            aria-label="Delete safety log"
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {deleteError && <p className="px-4 py-2 text-sm text-red-600">{deleteError}</p>}
              </div>
            </Card>

            {/* Certification Alerts + Operations */}
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Safety Operations</h3>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-gray-900">New Corrective Action</p>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={newAction.safety_log_id}
                    onChange={(event) => setNewAction((prev) => ({ ...prev, safety_log_id: event.target.value }))}
                  >
                    <option value="">Select safety log</option>
                    {safetyLogs.map((log) => (
                      <option key={log.id} value={log.id}>{log.summary}</option>
                    ))}
                  </select>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Action title"
                    value={newAction.title}
                    onChange={(event) => setNewAction((prev) => ({ ...prev, title: event.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={newAction.owner_employee_id}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, owner_employee_id: event.target.value }))}
                    >
                      <option value="">Owner</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                      ))}
                    </select>
                    <input
                      type="date"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={newAction.due_date}
                      onChange={(event) => setNewAction((prev) => ({ ...prev, due_date: event.target.value }))}
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleCreateAction} disabled={submitLoading}>
                    <Icon name="plus" className="mr-2" />Add Action
                  </Button>
                  {actionsError && <p className="text-sm text-red-600">{actionsError}</p>}
                </div>

                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-gray-900">Open Actions</p>
                  {actionsLoading ? (
                    <p className="text-sm text-gray-500">Loading actions...</p>
                  ) : actions.length === 0 ? (
                    <p className="text-sm text-gray-500">No actions yet.</p>
                  ) : actions.slice(0, 5).map((action) => (
                    <div key={action.id} className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg p-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{action.title}</p>
                        <p className="text-xs text-gray-500">{action.status} {action.due_date ? `· due ${formatDate(action.due_date)}` : ''}</p>
                      </div>
                      {action.status !== 'closed' ? (
                        <Button variant="secondary" size="sm" onClick={() => handleCloseAction(action.id)}>Close</Button>
                      ) : (
                        <Badge variant="success">Closed</Badge>
                      )}
                    </div>
                  ))}
                </div>

                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-gray-900">New Toolbox Talk</p>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Topic"
                    value={newTalk.topic}
                    onChange={(event) => setNewTalk((prev) => ({ ...prev, topic: event.target.value }))}
                  />
                  <input
                    type="date"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={newTalk.occurred_on}
                    onChange={(event) => setNewTalk((prev) => ({ ...prev, occurred_on: event.target.value }))}
                  />
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    rows={2}
                    placeholder="Summary"
                    value={newTalk.summary}
                    onChange={(event) => setNewTalk((prev) => ({ ...prev, summary: event.target.value }))}
                  />
                  <div className="max-h-28 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                    {employees.map((employee) => (
                      <label key={employee.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={newTalk.attendee_employee_ids.includes(String(employee.id))}
                          onChange={(event) => {
                            const value = String(employee.id);
                            setNewTalk((prev) => ({
                              ...prev,
                              attendee_employee_ids: event.target.checked
                                ? [...prev.attendee_employee_ids, value]
                                : prev.attendee_employee_ids.filter((id) => id !== value),
                            }));
                          }}
                        />
                        {employee.name}
                      </label>
                    ))}
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleCreateToolboxTalk} disabled={submitLoading}>
                    <Icon name="plus" className="mr-2" />Add Talk
                  </Button>
                  {toolboxError && <p className="text-sm text-red-600">{toolboxError}</p>}
                </div>

                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-gray-900">Recent Toolbox Talks</p>
                  {toolboxLoading ? (
                    <p className="text-sm text-gray-500">Loading toolbox talks...</p>
                  ) : toolboxTalks.length === 0 ? (
                    <p className="text-sm text-gray-500">No toolbox talks yet.</p>
                  ) : toolboxTalks.slice(0, 5).map((talk) => (
                    <div key={talk.id} className="border border-gray-200 rounded-lg p-2">
                      <p className="text-sm font-medium text-gray-900">{talk.topic}</p>
                      <p className="text-xs text-gray-500">{formatDate(talk.occurred_on)} · {Number(talk.attendees_count || 0)} attendees</p>
                    </div>
                  ))}
                </div>

                {expiringCerts.map((cert, i) => (
                  <div key={i} className={`p-4 ${cert.daysLeft < 0 ? 'bg-red-50' : cert.daysLeft < 30 ? 'bg-yellow-50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">{cert.employeeName}</p>
                        <p className="text-sm text-gray-500">{cert.name}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant={cert.daysLeft < 0 ? 'danger' : cert.daysLeft < 30 ? 'warning' : 'info'}>
                          {cert.daysLeft < 0 ? 'Expired' : `${cert.daysLeft} days left`}
                        </Badge>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(cert.expires)}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {expiringCerts.length === 0 && (
                  <div className="p-8 text-center text-gray-500">
                    <Icon name="circle-check" className="text-3xl text-green-500 mb-2" />
                    <p>All certifications are current!</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      );
    };

    // ============================================
    // INVENTORY VIEW
    // ============================================
    const InventoryView = ({ inventory, inventoryLoading, setInventory, jobs, vendors, setShowModal }) => {
      const [filter, setFilter] = useState('all');
      const [search, setSearch] = useState('');
      const [showAddModal, setShowAddModal] = useState(false);
      const [showTxnModal, setShowTxnModal] = useState(false);
      const [selectedItemId, setSelectedItemId] = useState(null);
      const [txnType, setTxnType] = useState('receive');
      const [txnLoading, setTxnLoading] = useState(false);
      const [txnError, setTxnError] = useState('');
      const [ledgerLoading, setLedgerLoading] = useState(false);
      const [ledgerItems, setLedgerItems] = useState([]);
      const [saveLoading, setSaveLoading] = useState(false);
      const [deleteLoadingId, setDeleteLoadingId] = useState(null);
      const [formError, setFormError] = useState('');
      const [editingId, setEditingId] = useState(null);
      const [itemForm, setItemForm] = useState({
        name: '',
        category: 'Materials',
        unit: 'EA',
        qtyOnHand: 0,
        qtyReserved: 0,
        reorderPoint: 0,
        unitCost: 0,
        location: '',
        jobId: '',
        status: 'active',
      });
      const [txnForm, setTxnForm] = useState({
        qty: 1,
        unit_cost: 0,
        job_id: '',
        from_location: '',
        to_location: '',
        notes: '',
      });

      const resetForm = () => {
        setItemForm({
          name: '',
          category: 'Materials',
          unit: 'EA',
          qtyOnHand: 0,
          qtyReserved: 0,
          reorderPoint: 0,
          unitCost: 0,
          location: '',
          jobId: '',
          status: 'active',
        });
        setEditingId(null);
        setFormError('');
      };

      const openCreateModal = () => {
        resetForm();
        setShowAddModal(true);
      };

      const openEditModal = (item) => {
        setEditingId(item.id);
        setFormError('');
        setItemForm({
          name: item.name || '',
          category: item.category || 'Materials',
          unit: item.unit || 'EA',
          qtyOnHand: Number(item.qtyOnHand || 0),
          qtyReserved: Number(item.qtyReserved || 0),
          reorderPoint: Number(item.reorderPoint || 0),
          unitCost: Number(item.unitCost || 0),
          location: item.location || '',
          jobId: item.jobId ?? '',
          status: item.status || 'active',
        });
        setShowAddModal(true);
      };

      const closeModal = () => {
        setShowAddModal(false);
        resetForm();
      };

      const handleSaveItem = async () => {
        if (!itemForm.name.trim()) {
          setFormError('Name is required');
          return;
        }

        setSaveLoading(true);
        setFormError('');

        const payload = {
          name: itemForm.name.trim(),
          category: itemForm.category || 'Materials',
          unit: itemForm.unit || 'EA',
          quantity_on_hand: Number(itemForm.qtyOnHand || 0),
          qty_reserved: Number(itemForm.qtyReserved || 0),
          reorder_point: Number(itemForm.reorderPoint || 0),
          unit_cost: Number(itemForm.unitCost || 0),
          location: itemForm.location || '',
          job_id: itemForm.jobId === '' ? null : itemForm.jobId,
          status: itemForm.status || 'active',
        };

        try {
          const response = await fetch(editingId ? `/api/inventory/${editingId}` : '/api/inventory', {
            method: editingId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const raw = await response.text();
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }

          const savedItem = parsed?.item;
          if (!response.ok || !savedItem) {
            setFormError(parsed?.error || raw || 'Failed to save inventory item');
            setSaveLoading(false);
            return;
          }

          setInventory((prev) => {
            if (editingId) {
              return prev.map((item) => (String(item.id) === String(editingId) ? savedItem : item));
            }
            return [savedItem, ...prev];
          });
          closeModal();
        } catch {
          setFormError('Failed to save inventory item');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleDeleteItem = async (itemId) => {
        const confirmed = confirmDestructiveAction('this inventory item');
        if (!confirmed) return;

        setDeleteLoadingId(itemId);
        try {
          const response = await fetch(`/api/inventory/${itemId}`, { method: 'DELETE' });
          const raw = await response.text();
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }

          if (!response.ok || !parsed?.success) {
            setFormError(parsed?.error || raw || 'Failed to delete inventory item');
            setDeleteLoadingId(null);
            return;
          }

          setInventory((prev) => prev.filter((item) => String(item.id) !== String(itemId)));
        } catch {
          setFormError('Failed to delete inventory item');
        } finally {
          setDeleteLoadingId(null);
        }
      };

      const categories = [...new Set(inventory.map(i => i.category))];
      const selectedItem = inventory.find((item) => String(item.id) === String(selectedItemId)) || null;
      const filteredInventory = inventory.filter(item => {
        if (filter !== 'all' && item.category !== filter) return false;
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });

      const lowStock = inventory.filter(i => i.qtyOnHand <= i.reorderPoint);
      const totalValue = inventory.reduce((sum, i) => sum + (i.qtyOnHand * i.unitCost), 0);

      useEffect(() => {
        let isMounted = true;
        const loadLedger = async () => {
          if (!selectedItemId) {
            if (isMounted) setLedgerItems([]);
            return;
          }
          try {
            setLedgerLoading(true);
            const response = await fetch(`/api/inventory/${selectedItemId}/ledger?limit=20`, { cache: 'no-store' });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load ledger');
            }
            if (isMounted) {
              setLedgerItems(payload?.items || []);
            }
          } catch {
            if (isMounted) {
              setLedgerItems([]);
            }
          } finally {
            if (isMounted) {
              setLedgerLoading(false);
            }
          }
        };
        loadLedger();
        return () => {
          isMounted = false;
        };
      }, [selectedItemId]);

      const openTxnModal = (item, type) => {
        setSelectedItemId(item.id);
        setTxnType(type);
        setTxnError('');
        setTxnForm({
          qty: 1,
          unit_cost: Number(item.lastUnitCost ?? item.unitCost ?? 0),
          job_id: item.jobId ?? '',
          from_location: item.location || '',
          to_location: item.location || '',
          notes: '',
        });
        setShowTxnModal(true);
      };

      const closeTxnModal = () => {
        setShowTxnModal(false);
        setTxnError('');
      };

      const handleTxnSubmit = async () => {
        if (!selectedItemId) return;
        setTxnLoading(true);
        setTxnError('');
        try {
          const endpoint = `/api/inventory/${selectedItemId}/${txnType}`;
          const payload = {
            qty: Number(txnForm.qty || 0),
            unit_cost: Number(txnForm.unit_cost || 0),
            job_id: txnForm.job_id || null,
            from_location: txnForm.from_location || '',
            to_location: txnForm.to_location || '',
            notes: txnForm.notes || '',
          };
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await response.json().catch(() => null);
          if (!response.ok || !json?.item?.inventory) {
            setTxnError(json?.error || 'Failed to apply transaction');
            setTxnLoading(false);
            return;
          }
          setInventory((prev) =>
            prev.map((item) => (String(item.id) === String(selectedItemId) ? json.item.inventory : item))
          );
          setLedgerItems((prev) => [json.item.transaction, ...prev].filter(Boolean).slice(0, 20));
          setShowTxnModal(false);
        } catch {
          setTxnError('Failed to apply transaction');
        } finally {
          setTxnLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="boxes-stacked" label="Total Items" value={inventory.length} color="brand" />
            <StatCard icon="triangle-exclamation" label="Low Stock Alerts" value={lowStock.length} color="red" />
            <StatCard icon="dollar-sign" label="Inventory Value" value={formatCurrency(totalValue)} color="green" />
            <StatCard icon="truck-ramp-box" label="Reserved Items" value={inventory.filter(i => i.qtyReserved > 0).length} color="blue" />
          </StatGrid>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 min-w-0">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-auto">
                <option value="all">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="w-full sm:w-72">
                <SearchInput value={search} onChange={setSearch} placeholder="Search inventory..." />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 sm:flex-none"><Icon name="file-export" className="mr-2" />Export</Button>
              <Button variant="brand" className="flex-1 sm:flex-none" onClick={openCreateModal}><Icon name="plus" className="mr-2" />Add Item</Button>
            </div>
          </div>

          {lowStock.length > 0 && (
            <Card className="p-4 bg-red-50 border-red-200">
              <h4 className="font-medium text-red-800 mb-2"><Icon name="triangle-exclamation" className="mr-2" />Low Stock Alert</h4>
              <div className="flex flex-wrap gap-2">
                {lowStock.map(item => (
                  <Badge key={item.id} variant="danger">{item.name}: {item.qtyOnHand} {item.unit} remaining</Badge>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-0 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">On Hand</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reserved</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Available</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reorder</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Last Unit Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryLoading ? (
                  <tr>
                    <td className="px-4 py-4 text-sm text-gray-500" colSpan={10}>Loading inventory...</td>
                  </tr>
                ) : filteredInventory.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-sm text-gray-500" colSpan={10}>No inventory items yet.</td>
                  </tr>
                ) : filteredInventory.map(item => {
                  const job = jobs.find(j => j.id === item.jobId);
                  const isLow = item.qtyOnHand <= item.reorderPoint;
                  return (
                    <tr key={item.id} className={`hover:bg-gray-50 ${isLow ? 'bg-red-50' : ''} ${selectedItemId === item.id ? 'ring-1 ring-brand-300' : ''}`} onClick={() => setSelectedItemId(item.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isLow && <Icon name="triangle-exclamation" className="text-red-500" />}
                          <span className="font-medium text-gray-900">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.category}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{item.qtyOnHand} {item.unit}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-500">{item.qtyReserved} {item.unit}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-green-600">{item.qtyOnHand - item.qtyReserved} {item.unit}</td>
                      <td className="px-4 py-3 text-sm text-right">{item.reorderPoint} {item.unit}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(item.lastUnitCost ?? item.unitCost)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.location}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{job?.name || 'General'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openTxnModal(item, 'receive'); }}><Icon name="plus" /></Button>
                        <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openTxnModal(item, 'issue'); }}><Icon name="arrow-up-right-from-square" /></Button>
                        <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openTxnModal(item, 'adjust'); }}><Icon name="sliders" /></Button>
                        <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openTxnModal(item, 'transfer'); }}><Icon name="right-left" /></Button>
                        <Button variant="secondary" size="sm" onClick={(event) => { event.stopPropagation(); openEditModal(item); }}><Icon name="pen-to-square" /></Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(event) => { event.stopPropagation(); handleDeleteItem(item.id); }}
                          disabled={deleteLoadingId === item.id}
                        >
                          <Icon name={deleteLoadingId === item.id ? 'spinner' : 'trash'} className={deleteLoadingId === item.id ? 'animate-spin' : ''} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {selectedItem && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-gray-900">Ledger · {selectedItem.name}</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <div>
                  <p className="text-xs text-gray-500">On Hand</p>
                  <p className="text-sm font-semibold">{selectedItem.qtyOnHand} {selectedItem.unit}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Reserved</p>
                  <p className="text-sm font-semibold">{selectedItem.qtyReserved} {selectedItem.unit}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Available</p>
                  <p className="text-sm font-semibold">{(selectedItem.qtyOnHand - selectedItem.qtyReserved)} {selectedItem.unit}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Reorder Point</p>
                  <p className="text-sm font-semibold">{selectedItem.reorderPoint} {selectedItem.unit}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Last Unit Cost</p>
                  <p className="text-sm font-semibold">{formatCurrency(selectedItem.lastUnitCost ?? selectedItem.unitCost)}</p>
                </div>
              </div>
              {ledgerLoading ? (
                <p className="text-sm text-gray-500">Loading ledger...</p>
              ) : ledgerItems.length === 0 ? (
                <p className="text-sm text-gray-500">No transactions yet.</p>
              ) : (
                <div className="space-y-2">
                  {ledgerItems.map((entry) => (
                    <div key={entry.id} className="border border-gray-200 rounded-lg p-2 text-sm flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-gray-900">{String(entry.type || '').toUpperCase()}</p>
                        <p className="text-xs text-gray-500">{formatDate(entry.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{entry.qty}</p>
                        <p className="text-xs text-gray-500">{formatCurrency(entry.unitCost || 0)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeModal} aria-label="Close inventory modal" />
              <Card className="relative z-10 w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit Item' : 'Add Item'}</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={closeModal}>
                    <Icon name="xmark" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Name</p>
                    <input type="text" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Category</p>
                    <input type="text" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Unit</p>
                    <input type="text" value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">On Hand</p>
                    <input type="number" value={itemForm.qtyOnHand} onChange={(e) => setItemForm({ ...itemForm, qtyOnHand: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Reserved</p>
                    <input type="number" value={itemForm.qtyReserved} onChange={(e) => setItemForm({ ...itemForm, qtyReserved: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Reorder Point</p>
                    <input type="number" value={itemForm.reorderPoint} onChange={(e) => setItemForm({ ...itemForm, reorderPoint: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Unit Cost</p>
                    <input type="number" step="0.01" value={itemForm.unitCost} onChange={(e) => setItemForm({ ...itemForm, unitCost: Number(e.target.value) })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Location</p>
                    <input type="text" value={itemForm.location} onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Job</p>
                    <select value={itemForm.jobId} onChange={(e) => setItemForm({ ...itemForm, jobId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="">General</option>
                      {jobs.map(job => (
                        <option key={job.id} value={job.id}>{job.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="active">active</option>
                      <option value="low_stock">low_stock</option>
                      <option value="out_of_stock">out_of_stock</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>
                </div>

                {formError && <p className="text-sm text-red-600 mt-4">{formError}</p>}

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={closeModal}>Cancel</Button>
                  <Button variant="brand" onClick={handleSaveItem} disabled={saveLoading}>
                    <Icon name={saveLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${saveLoading ? 'animate-spin' : ''}`} />
                    {editingId ? 'Save Item' : 'Create Item'}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {showTxnModal && selectedItem && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeTxnModal} aria-label="Close inventory transaction modal" />
              <Card className="relative z-10 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{txnType.charAt(0).toUpperCase() + txnType.slice(1)} · {selectedItem.name}</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={closeTxnModal}>
                    <Icon name="xmark" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Quantity</p>
                    <input type="number" min="0" step="0.01" value={txnForm.qty} onChange={(e) => setTxnForm((prev) => ({ ...prev, qty: Number(e.target.value) }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  {(txnType === 'receive' || txnType === 'adjust') && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Unit Cost</p>
                      <input type="number" min="0" step="0.01" value={txnForm.unit_cost} onChange={(e) => setTxnForm((prev) => ({ ...prev, unit_cost: Number(e.target.value) }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  )}
                  {txnType === 'issue' && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Issue to Job (optional)</p>
                      <select value={txnForm.job_id} onChange={(e) => setTxnForm((prev) => ({ ...prev, job_id: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="">No job</option>
                        {jobs.map((job) => (
                          <option key={job.id} value={job.id}>{job.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {(txnType === 'issue' || txnType === 'transfer') && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">From Location</p>
                      <input type="text" value={txnForm.from_location} onChange={(e) => setTxnForm((prev) => ({ ...prev, from_location: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  )}
                  {(txnType === 'receive' || txnType === 'transfer') && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">To Location</p>
                      <input type="text" value={txnForm.to_location} onChange={(e) => setTxnForm((prev) => ({ ...prev, to_location: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <textarea value={txnForm.notes} onChange={(e) => setTxnForm((prev) => ({ ...prev, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-20" />
                  </div>
                </div>
                {txnError && <p className="text-sm text-red-600 mt-4">{txnError}</p>}
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={closeTxnModal}>Cancel</Button>
                  <Button variant="brand" onClick={handleTxnSubmit} disabled={txnLoading}>
                    <Icon name={txnLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${txnLoading ? 'animate-spin' : ''}`} />
                    {txnLoading ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // TRAINING VIEW (with Video Lessons)
    // ============================================
    const TrainingView = ({ trainingData, setTrainingData, employees, setShowModal, trainingLoading, trainingError, onRefreshTraining }) => {
      const [filter, setFilter] = useState('all');
      const [selectedVideoId, setSelectedVideoId] = useState(null);
      const [showAssignModal, setShowAssignModal] = useState(false);
      const [showCourseModal, setShowCourseModal] = useState(false);
      const [saveError, setSaveError] = useState('');
      const [saveLoading, setSaveLoading] = useState(false);
      const [courseForm, setCourseForm] = useState({
        title: '',
        category: 'Safety',
        durationMinutes: 20,
        videoUrl: '',
        thumbnailUrl: '',
        required: false,
        dueDate: '',
      });
      const [assignForm, setAssignForm] = useState({
        courseId: '',
        employeeIds: [],
        required: false,
        dueDate: '',
      });
      const [completeEmployeeId, setCompleteEmployeeId] = useState('');

      const normalizedEmployees = useMemo(
        () =>
          (employees || []).map((employee) => ({
            ...employee,
            _id: String(employee.id),
          })),
        [employees]
      );

      const selectedVideo = useMemo(
        () =>
          trainingData.find((course) => String(course.id) === String(selectedVideoId)) ||
          trainingData[0] ||
          null,
        [trainingData, selectedVideoId]
      );

      useEffect(() => {
        if (!selectedVideo && trainingData.length > 0) {
          setSelectedVideoId(trainingData[0].id);
        }
      }, [selectedVideo, trainingData]);

      const categories = [...new Set(trainingData.map(t => t.category).filter(Boolean))];
      const filteredTraining = trainingData.filter(t => filter === 'all' || t.category === filter);

      const getAssignedCount = useCallback(
        (course) => {
          const assignedCount = (course.assignedEmployeeIds || []).length;
          return assignedCount > 0 ? assignedCount : normalizedEmployees.length;
        },
        [normalizedEmployees.length]
      );

      const requiredIncomplete = trainingData.filter((course) => course.required && course.completedBy.length < getAssignedCount(course));
      const totalCompleted = trainingData.reduce((sum, t) => sum + t.completedBy.length, 0);
      const totalRequired = trainingData.reduce((sum, course) => sum + (course.required ? getAssignedCount(course) : 0), 0);
      const completionRate = totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 0;
      const totalWatchTime = trainingData.reduce((sum, course) => sum + Number.parseInt(String(course.duration || '0'), 10), 0);

      const handleCreateCourse = async () => {
        if (!courseForm.title.trim()) {
          setSaveError('Course title is required');
          return;
        }

        try {
          setSaveLoading(true);
          setSaveError('');
          const response = await fetch('/api/training/courses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: courseForm.title.trim(),
              category: courseForm.category.trim() || 'General',
              durationMinutes: Number(courseForm.durationMinutes || 0),
              videoUrl: courseForm.videoUrl.trim(),
              thumbnailUrl: courseForm.thumbnailUrl.trim(),
              required: Boolean(courseForm.required),
              dueDate: courseForm.dueDate || null,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.item) {
            setSaveError(payload?.error || 'Failed to create course');
            return;
          }
          await onRefreshTraining();
          setShowCourseModal(false);
          setCourseForm({
            title: '',
            category: 'Safety',
            durationMinutes: 20,
            videoUrl: '',
            thumbnailUrl: '',
            required: false,
            dueDate: '',
          });
          setSelectedVideoId(payload.item.id);
        } catch {
          setSaveError('Failed to create course');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleAssignCourse = async () => {
        if (!assignForm.courseId) {
          setSaveError('Select a course');
          return;
        }
        if (assignForm.employeeIds.length === 0) {
          setSaveError('Select at least one employee');
          return;
        }

        try {
          setSaveLoading(true);
          setSaveError('');
          const response = await fetch(`/api/training/courses/${assignForm.courseId}/assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              employeeIds: assignForm.employeeIds,
              required: assignForm.required,
              dueDate: assignForm.dueDate || null,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.item) {
            setSaveError(payload?.error || 'Failed to assign training');
            return;
          }
          await onRefreshTraining();
          setShowAssignModal(false);
        } catch {
          setSaveError('Failed to assign training');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleMarkComplete = async (completed) => {
        if (!selectedVideo || !completeEmployeeId) return;
        try {
          setSaveLoading(true);
          setSaveError('');
          const response = await fetch('/api/training/progress/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              courseId: selectedVideo.id,
              employeeId: completeEmployeeId,
              completed,
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload?.item) {
            setSaveError(payload?.error || 'Failed to update completion');
            return;
          }
          await onRefreshTraining();
          setSelectedVideoId(String(selectedVideo.id));
        } catch {
          setSaveError('Failed to update completion');
        } finally {
          setSaveLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="graduation-cap" label="Total Courses" value={trainingData.length} color="brand" />
            <StatCard icon="circle-check" label="Completion Rate" value={`${completionRate}%`} color="green" />
            <StatCard icon="clock" label="Required Incomplete" value={requiredIncomplete.length} color="red" />
            <StatCard icon="play-circle" label="Total Watch Time" value={`${totalWatchTime} min`} color="blue" />
          </StatGrid>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="all">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => {
                setAssignForm((prev) => ({ ...prev, courseId: selectedVideo ? String(selectedVideo.id) : '' }));
                setShowAssignModal(true);
              }}>
                <Icon name="user-plus" className="mr-2" />Assign Training
              </Button>
              <Button variant="brand" onClick={() => setShowCourseModal(true)}><Icon name="plus" className="mr-2" />Add Course</Button>
            </div>
          </div>

          {trainingError ? <InlineError>{trainingError}</InlineError> : null}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              {trainingLoading ? (
                <LoadingBlock label="Loading training courses..." />
              ) : filteredTraining.length === 0 ? (
                <EmptyState
                  icon="graduation-cap"
                  title="No training courses yet"
                  description="Add your first course to start assigning training."
                />
              ) : filteredTraining.map(course => {
                const assignedCount = getAssignedCount(course);
                const completionPct = assignedCount > 0 ? Math.round((course.completedBy.length / assignedCount) * 100) : 0;
                return (
                  <Card key={course.id} className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setSelectedVideoId(course.id)}>
                    <div className="relative">
                      <img src={course.thumbnail} alt={course.title} className="w-full h-32 object-cover" />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <Icon name="play-circle" className="text-white text-4xl" />
                      </div>
                      <div className="absolute top-2 right-2">
                        {course.required && <Badge variant="danger">Required</Badge>}
                      </div>
                      <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {course.duration}
                      </div>
                    </div>
                    <div className="p-4">
                      <h4 className="font-medium text-gray-900 mb-1">{course.title}</h4>
                      <p className="text-sm text-gray-500 mb-3">{course.category}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 mr-4">
                          <ProgressBar value={completionPct} color={completionPct === 100 ? 'green' : 'brand'} size="sm" />
                        </div>
                        <span className="text-xs text-gray-500">{course.completedBy.length}/{assignedCount}</span>
                      </div>
                      {course.dueDate && (
                        <p className={`text-xs mt-2 ${getDaysUntil(course.dueDate) < 14 ? 'text-red-600' : 'text-gray-500'}`}>
                          <Icon name="calendar" className="mr-1" />Due: {formatDate(course.dueDate)}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            {selectedVideo ? (
              <Card className="p-4 h-fit sticky top-4">
                <div className="aspect-video mb-4 bg-black rounded-lg overflow-hidden">
                  <iframe
                    src={selectedVideo.videoUrl}
                    className="w-full h-full"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{selectedVideo.title}</h3>
                <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                  <span><Icon name="clock" className="mr-1" />{selectedVideo.duration}</span>
                  <span><Icon name="folder" className="mr-1" />{selectedVideo.category}</span>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Completion Status</p>
                  <ProgressBar value={(selectedVideo.completedBy.length / (getAssignedCount(selectedVideo) || 1)) * 100} color="green" />
                  <p className="text-sm mt-1">{selectedVideo.completedBy.length} of {getAssignedCount(selectedVideo)} employees completed</p>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Completed By</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedVideo.completedBy.map(empId => {
                      const emp = normalizedEmployees.find((employee) => employee._id === String(empId));
                      return emp ? (
                        <Badge key={empId} variant="success">{emp.name}</Badge>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-2">Not Completed</p>
                  <div className="flex flex-wrap gap-1">
                    {normalizedEmployees
                      .filter((employee) => {
                        const assigned = (selectedVideo.assignedEmployeeIds || []).map((value) => String(value));
                        return (assigned.length === 0 || assigned.includes(employee._id)) && !selectedVideo.completedBy.map((value) => String(value)).includes(employee._id);
                      })
                      .map((employee) => (
                        <Badge key={employee._id} variant="warning">{employee.name}</Badge>
                      ))}
                  </div>
                </div>

                <div className="space-y-2 mb-3">
                  <p className="text-xs text-gray-500">Mark Completion</p>
                  <select
                    value={completeEmployeeId}
                    onChange={(event) => setCompleteEmployeeId(event.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select employee</option>
                    {normalizedEmployees.map((employee) => (
                      <option key={employee._id} value={employee._id}>{employee.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="brand" onClick={() => handleMarkComplete(true)} disabled={saveLoading || !completeEmployeeId}>
                    <Icon name="check" className="mr-2" />Complete
                  </Button>
                  <Button variant="secondary" onClick={() => handleMarkComplete(false)} disabled={saveLoading || !completeEmployeeId}>
                    <Icon name="rotate-left" className="mr-2" />Reset
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="play-circle" className="text-4xl mb-2 text-gray-300" />
                <p>Select a course to view details</p>
              </Card>
            )}
          </div>

          {saveError ? <InlineError>{saveError}</InlineError> : null}

          {showAssignModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={() => setShowAssignModal(false)} aria-label="Close assign training modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Assign Training</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowAssignModal(false)}>
                    <Icon name="xmark" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Course</p>
                    <select
                      value={assignForm.courseId}
                      onChange={(event) => setAssignForm((prev) => ({ ...prev, courseId: event.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Select course</option>
                      {trainingData.map((course) => (
                        <option key={course.id} value={course.id}>{course.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={assignForm.required}
                        onChange={(event) => setAssignForm((prev) => ({ ...prev, required: event.target.checked }))}
                      />
                      Required
                    </label>
                    <input
                      type="date"
                      value={assignForm.dueDate}
                      onChange={(event) => setAssignForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Employees</p>
                    <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                      {normalizedEmployees.map((employee) => (
                        <label key={employee._id} className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={assignForm.employeeIds.includes(employee._id)}
                            onChange={(event) => {
                              setAssignForm((prev) => ({
                                ...prev,
                                employeeIds: event.target.checked
                                  ? [...prev.employeeIds, employee._id]
                                  : prev.employeeIds.filter((id) => id !== employee._id),
                              }));
                            }}
                          />
                          {employee.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={() => setShowAssignModal(false)}>Cancel</Button>
                  <Button variant="brand" onClick={handleAssignCourse} disabled={saveLoading}>
                    <Icon name={saveLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${saveLoading ? 'animate-spin' : ''}`} />
                    Save Assignment
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {showCourseModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={() => setShowCourseModal(false)} aria-label="Close add course modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Add Course</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowCourseModal(false)}>
                    <Icon name="xmark" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Title</p>
                    <input type="text" value={courseForm.title} onChange={(event) => setCourseForm((prev) => ({ ...prev, title: event.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Category</p>
                    <input type="text" value={courseForm.category} onChange={(event) => setCourseForm((prev) => ({ ...prev, category: event.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Duration (minutes)</p>
                    <input type="number" min="0" value={courseForm.durationMinutes} onChange={(event) => setCourseForm((prev) => ({ ...prev, durationMinutes: Number(event.target.value) }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Video URL</p>
                    <input
                      type="url"
                      value={courseForm.videoUrl}
                      onChange={(event) =>
                        setCourseForm((prev) => {
                          const nextVideoUrl = event.target.value;
                          const autoThumb = deriveYouTubeThumbnail(nextVideoUrl, '');
                          return {
                            ...prev,
                            videoUrl: nextVideoUrl,
                            thumbnailUrl: prev.thumbnailUrl || autoThumb,
                          };
                        })
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Thumbnail URL (optional)</p>
                    <input type="url" value={courseForm.thumbnailUrl} onChange={(event) => setCourseForm((prev) => ({ ...prev, thumbnailUrl: event.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    {(deriveYouTubeThumbnail(courseForm.videoUrl, courseForm.thumbnailUrl) || '').trim() ? (
                      <img
                        src={deriveYouTubeThumbnail(courseForm.videoUrl, courseForm.thumbnailUrl)}
                        alt="Course thumbnail preview"
                        className="mt-2 h-20 w-36 object-cover rounded border border-gray-200"
                      />
                    ) : null}
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
                      <input type="checkbox" checked={courseForm.required} onChange={(event) => setCourseForm((prev) => ({ ...prev, required: event.target.checked }))} />
                      Required
                    </label>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Due Date</p>
                    <input type="date" value={courseForm.dueDate} onChange={(event) => setCourseForm((prev) => ({ ...prev, dueDate: event.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={() => setShowCourseModal(false)}>Cancel</Button>
                  <Button variant="brand" onClick={handleCreateCourse} disabled={saveLoading}>
                    <Icon name={saveLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${saveLoading ? 'animate-spin' : ''}`} />
                    Save Course
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // VENDORS VIEW
    // ============================================
    const VendorsView = ({ vendors, vendorsLoading, setVendors, jobs, inventory }) => {
      const [search, setSearch] = useState('');
      const [selectedVendorId, setSelectedVendorId] = useState(null);
      const [showVendorModal, setShowVendorModal] = useState(false);
      const [editingVendorId, setEditingVendorId] = useState(null);
      const [saveLoading, setSaveLoading] = useState(false);
      const [deleteLoading, setDeleteLoading] = useState(false);
      const [formError, setFormError] = useState('');
      const [vendorForm, setVendorForm] = useState({
        name: '',
        status: 'active',
        category: '',
        contact_name: '',
        phone: '',
        email: '',
        address: '',
        payment_terms: '',
        notes: '',
        rating: 0,
        active_orders: 0,
      });
      const [vendorSummary, setVendorSummary] = useState(null);
      const [vendorSummaryLoading, setVendorSummaryLoading] = useState(false);
      const [vendorSummaryError, setVendorSummaryError] = useState('');
      const [purchaseOrders, setPurchaseOrders] = useState([]);
      const [purchaseOrdersLoading, setPurchaseOrdersLoading] = useState(true);
      const [selectedPoId, setSelectedPoId] = useState(null);
      const [poItems, setPoItems] = useState([]);
      const [poItemsLoading, setPoItemsLoading] = useState(false);
      const [poError, setPoError] = useState('');
      const [poLoading, setPoLoading] = useState(false);
      const [poItemLoading, setPoItemLoading] = useState(false);
      const [showPoModal, setShowPoModal] = useState(false);
      const [editingPoId, setEditingPoId] = useState(null);
      const [editingPoItemId, setEditingPoItemId] = useState(null);
      const [poForm, setPoForm] = useState({
        vendor_id: '',
        job_id: '',
        status: 'draft',
        notes: '',
      });
      const [poItemForm, setPoItemForm] = useState({
        inventory_id: '',
        description: '',
        quantity: 1,
        unit_cost: 0,
      });

      const categories = [...new Set(vendors.map(v => v.category))];
      const selectedVendor = vendors.find((vendor) => String(vendor.id) === String(selectedVendorId)) || null;
      const vendorProfile = vendorSummary?.profile || selectedVendor || null;
      const vendorMetrics = vendorSummary?.metrics || { open_po_count: 0, total_spend_30d: 0, avg_delivery_days: 0 };
      const vendorOpenPOs = vendorSummary?.openPOs || [];
      const vendorDocuments = vendorSummary?.documents || [];
      const selectedPO = purchaseOrders.find((po) => String(po.id) === String(selectedPoId)) || null;

      const filteredVendors = vendors.filter(v =>
        !search ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        (v.category || '').toLowerCase().includes(search.toLowerCase()) ||
        (v.contact || '').toLowerCase().includes(search.toLowerCase())
      );

      const toStarRating = (ratingValue) => {
        const numeric = Number(ratingValue || 0);
        const fiveScale = numeric > 5 ? numeric / 20 : numeric;
        return Math.max(0, Math.min(5, Math.round(fiveScale)));
      };

      const renderStars = (rating) => (
        <div className="flex gap-0.5">
          {[1,2,3,4,5].map(i => (
            <Icon key={i} name="star" className={`text-sm ${i <= toStarRating(rating) ? 'text-yellow-400' : 'text-gray-300'}`} />
          ))}
        </div>
      );

      useEffect(() => {
        let isMounted = true;

        const loadPurchaseOrders = async () => {
          try {
            setPurchaseOrdersLoading(true);
            const response = await fetch('/api/purchase-orders', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load purchase orders');
            }
            if (isMounted) {
              setPurchaseOrders(payload.purchase_orders || []);
            }
          } catch {
            if (isMounted) {
              setPurchaseOrders([]);
            }
          } finally {
            if (isMounted) {
              setPurchaseOrdersLoading(false);
            }
          }
        };

        loadPurchaseOrders();
        return () => {
          isMounted = false;
        };
      }, []);

      useEffect(() => {
        let isMounted = true;
        const loadPoItems = async () => {
          if (!selectedPoId) {
            if (isMounted) setPoItems([]);
            return;
          }
          try {
            setPoItemsLoading(true);
            const response = await fetch(`/api/purchase-orders/${selectedPoId}/items`, { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load purchase order items');
            }
            if (isMounted) setPoItems(payload.items || []);
          } catch {
            if (isMounted) setPoItems([]);
          } finally {
            if (isMounted) setPoItemsLoading(false);
          }
        };

        loadPoItems();
        return () => {
          isMounted = false;
        };
      }, [selectedPoId]);

      useEffect(() => {
        let isMounted = true;

        const loadVendorSummary = async () => {
          if (!selectedVendorId) {
            if (isMounted) {
              setVendorSummary(null);
              setVendorSummaryError('');
            }
            return;
          }
          try {
            setVendorSummaryLoading(true);
            setVendorSummaryError('');
            const response = await fetch(`/api/vendors/${selectedVendorId}/summary`, { cache: 'no-store' });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.item) {
              throw new Error(payload?.error || 'Failed to load vendor summary');
            }
            if (isMounted) {
              setVendorSummary(payload.item);
            }
          } catch (error) {
            if (isMounted) {
              setVendorSummary(null);
              setVendorSummaryError(error instanceof Error ? error.message : 'Failed to load vendor summary');
            }
          } finally {
            if (isMounted) {
              setVendorSummaryLoading(false);
            }
          }
        };

        loadVendorSummary();
        return () => {
          isMounted = false;
        };
      }, [selectedVendorId]);

      const resetForm = () => {
        setVendorForm({
          name: '',
          status: 'active',
          category: '',
          contact_name: '',
          phone: '',
          email: '',
          address: '',
          payment_terms: '',
          notes: '',
          rating: 0,
          active_orders: 0,
        });
        setEditingVendorId(null);
        setFormError('');
      };

      const openCreateModal = () => {
        resetForm();
        setShowVendorModal(true);
      };

      const openEditModal = (vendor) => {
        setEditingVendorId(vendor.id);
        setFormError('');
        setVendorForm({
          name: vendor.name || '',
          status: vendor.status || 'active',
          category: vendor.category || '',
          contact_name: vendor.contact_name || vendor.contact || '',
          phone: vendor.phone || '',
          email: vendor.email || '',
          address: vendor.address || '',
          payment_terms: vendor.payment_terms || '',
          notes: vendor.notes || '',
          rating: Number(vendor.rating || 0),
          active_orders: Number(vendor.active_orders ?? vendor.activeOrders ?? 0),
        });
        setShowVendorModal(true);
      };

      const closeModal = () => {
        setShowVendorModal(false);
        resetForm();
      };

      const openCreatePoModal = () => {
        setEditingPoId(null);
        setPoError('');
        setPoForm({
          vendor_id: selectedVendor?.id || vendors[0]?.id || '',
          job_id: '',
          status: 'draft',
          notes: '',
        });
        setShowPoModal(true);
      };

      const openEditPoModal = (po) => {
        setEditingPoId(po.id);
        setPoError('');
        setPoForm({
          vendor_id: po.vendor_id || '',
          job_id: po.job_id || '',
          status: po.status || 'draft',
          notes: po.notes || '',
        });
        setShowPoModal(true);
      };

      const closePoModal = () => {
        setShowPoModal(false);
        setEditingPoId(null);
        setPoError('');
      };

      const handleSaveVendor = async () => {
        if (!vendorForm.name.trim()) {
          setFormError('Name is required');
          return;
        }

        setSaveLoading(true);
        setFormError('');

        try {
          const response = await fetch(editingVendorId ? `/api/vendors/${editingVendorId}` : '/api/vendors', {
            method: editingVendorId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: vendorForm.name.trim(),
              status: vendorForm.status,
              category: vendorForm.category,
              contact_name: vendorForm.contact_name,
              phone: vendorForm.phone,
              email: vendorForm.email,
              address: vendorForm.address,
              payment_terms: vendorForm.payment_terms,
              notes: vendorForm.notes,
              rating: Number(vendorForm.rating || 0),
              active_orders: Number(vendorForm.active_orders || 0),
            }),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !(payload?.vendor || payload?.item)) {
            setFormError(payload?.error || raw || 'Failed to save vendor');
            setSaveLoading(false);
            return;
          }
          const savedVendor = payload.vendor || payload.item;

          setVendors((prev) => {
            if (editingVendorId) {
              return prev.map((vendor) => (String(vendor.id) === String(editingVendorId) ? savedVendor : vendor));
            }
            return [savedVendor, ...prev];
          });
          setVendorSummary((prev) =>
            prev ? { ...prev, profile: { ...(prev.profile || {}), ...savedVendor } } : prev
          );
          setSelectedVendorId(savedVendor.id);
          closeModal();
        } catch {
          setFormError('Failed to save vendor');
        } finally {
          setSaveLoading(false);
        }
      };

      const handleDeleteVendor = async () => {
        if (!selectedVendor) return;
        const confirmed = confirmDestructiveAction('this vendor');
        if (!confirmed) return;

        setDeleteLoading(true);
        setFormError('');
        try {
          const response = await fetch(`/api/vendors/${selectedVendor.id}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.success) {
            setFormError(payload?.error || raw || 'Failed to delete vendor');
            setDeleteLoading(false);
            return;
          }

          setVendors((prev) => prev.filter((vendor) => String(vendor.id) !== String(selectedVendor.id)));
          setSelectedVendorId(null);
        } catch {
          setFormError('Failed to delete vendor');
        } finally {
          setDeleteLoading(false);
        }
      };

      const handleSetVendorStatus = async (status) => {
        if (!selectedVendor) return;
        setFormError('');
        try {
          const response = await fetch(`/api/vendors/${selectedVendor.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !(payload?.item || payload?.vendor)) {
            setFormError(payload?.error || 'Failed to update vendor status');
            return;
          }
          const updatedVendor = payload.item || payload.vendor;
          setVendors((prev) => prev.map((vendor) => (String(vendor.id) === String(selectedVendor.id) ? updatedVendor : vendor)));
          setVendorSummary((prev) => (prev ? { ...prev, profile: { ...prev.profile, status: updatedVendor.status } } : prev));
        } catch {
          setFormError('Failed to update vendor status');
        }
      };

      const handleSavePO = async () => {
        if (!poForm.vendor_id) {
          setPoError('Vendor is required');
          return;
        }
        setPoLoading(true);
        setPoError('');
        try {
          const requestBody = {
            vendor_id: poForm.vendor_id,
            job_id: poForm.job_id || null,
            notes: poForm.notes,
            ...(editingPoId
              ? selectedPO && String(poForm.status || '') !== String(selectedPO.status || '')
                ? { status: poForm.status }
                : {}
              : { status: poForm.status }),
          };
          const response = await fetch(editingPoId ? `/api/purchase-orders/${editingPoId}` : '/api/purchase-orders', {
            method: editingPoId ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.purchase_order) {
            setPoError(payload?.error || raw || 'Failed to save purchase order');
            setPoLoading(false);
            return;
          }

          setPurchaseOrders((prev) => {
            if (editingPoId) {
              return prev.map((po) => (String(po.id) === String(editingPoId) ? payload.purchase_order : po));
            }
            return [payload.purchase_order, ...prev];
          });
          setSelectedPoId(payload.purchase_order.id);
          closePoModal();
        } catch {
          setPoError('Failed to save purchase order');
        } finally {
          setPoLoading(false);
        }
      };

      const handleDeletePO = async () => {
        if (!selectedPO) return;
        const confirmed = confirmDestructiveAction('this purchase order');
        if (!confirmed) return;
        setPoLoading(true);
        setPoError('');
        try {
          const response = await fetch(`/api/purchase-orders/${selectedPO.id}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setPoError(payload?.error || raw || 'Failed to delete purchase order');
            setPoLoading(false);
            return;
          }
          setPurchaseOrders((prev) => prev.filter((po) => String(po.id) !== String(selectedPO.id)));
          setSelectedPoId(null);
          setPoItems([]);
        } catch {
          setPoError('Failed to delete purchase order');
        } finally {
          setPoLoading(false);
        }
      };

      const handleSavePoItem = async () => {
        if (!selectedPO) return;
        if (!poItemForm.quantity || Number(poItemForm.quantity) <= 0) {
          setPoError('Quantity must be greater than 0');
          return;
        }
        setPoItemLoading(true);
        setPoError('');
        try {
          const response = await fetch(
            editingPoItemId
              ? `/api/purchase-orders/${selectedPO.id}/items/${editingPoItemId}`
              : `/api/purchase-orders/${selectedPO.id}/items`,
            {
              method: editingPoItemId ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                inventory_id: poItemForm.inventory_id || null,
                description: poItemForm.description || '',
                quantity: Number(poItemForm.quantity || 0),
                unit_cost: Number(poItemForm.unit_cost || 0),
              }),
            }
          );

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.item) {
            setPoError(payload?.error || raw || 'Failed to save line item');
            setPoItemLoading(false);
            return;
          }

          setPoItems((prev) => {
            if (editingPoItemId) {
              return prev.map((item) => (String(item.id) === String(editingPoItemId) ? payload.item : item));
            }
            return [payload.item, ...prev];
          });
          setEditingPoItemId(null);
          setPoItemForm({ inventory_id: '', description: '', quantity: 1, unit_cost: 0 });
        } catch {
          setPoError('Failed to save line item');
        } finally {
          setPoItemLoading(false);
        }
      };

      const handleEditPoItem = (item) => {
        setEditingPoItemId(item.id);
        setPoItemForm({
          inventory_id: item.inventory_id || '',
          description: item.description || '',
          quantity: Number(item.quantity || 1),
          unit_cost: Number(item.unit_cost || 0),
        });
      };

      const handleDeletePoItem = async (itemId) => {
        if (!selectedPO) return;
        const confirmed = confirmDestructiveAction('this purchase order line item');
        if (!confirmed) return;
        setPoItemLoading(true);
        setPoError('');
        try {
          const response = await fetch(`/api/purchase-orders/${selectedPO.id}/items/${itemId}`, { method: 'DELETE' });
          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }
          if (!response.ok || !payload?.success) {
            setPoError(payload?.error || raw || 'Failed to delete line item');
            setPoItemLoading(false);
            return;
          }
          setPoItems((prev) => prev.filter((item) => String(item.id) !== String(itemId)));
        } catch {
          setPoError('Failed to delete line item');
        } finally {
          setPoItemLoading(false);
        }
      };

      return (
        <div className="space-y-6">
          <StatGrid desktopColsClass="md:grid-cols-4" testId="stats-grid">
            <StatCard icon="building" label="Total Vendors" value={vendors.length} color="brand" />
            <StatCard icon="star" label="Top Rated" value={vendors.filter(v => v.rating === 5).length} color="yellow" />
            <StatCard icon="clipboard-list" label="Active Orders" value={vendors.reduce((sum, v) => sum + (v.activeOrders ?? v.active_orders ?? 0), 0)} color="blue" />
            <StatCard icon="tags" label="Categories" value={categories.length} color="green" />
          </StatGrid>

          <div className="flex items-center justify-between">
            <SearchInput value={search} onChange={setSearch} placeholder="Search vendors..." />
            <Button variant="brand" onClick={openCreateModal}><Icon name="plus" className="mr-2" />Add Vendor</Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              {vendorsLoading ? (
                <Card className="p-4">
                  <p className="text-sm text-gray-500">Loading vendors...</p>
                </Card>
              ) : filteredVendors.length === 0 ? (
                <Card className="p-4">
                  <p className="text-sm text-gray-500">No vendors found.</p>
                </Card>
              ) : filteredVendors.map(vendor => (
                <Card
                  key={vendor.id}
                  className={`p-4 cursor-pointer transition-all ${selectedVendorId === vendor.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                  onClick={() => setSelectedVendorId(vendor.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                        <Icon name="building" className="text-gray-500 text-xl" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{vendor.name}</h4>
                        <p className="text-sm text-gray-500">{vendor.category}</p>
                        {renderStars(vendor.rating)}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">{vendor.contact}</p>
                      <p className="text-sm text-gray-500">{vendor.phone}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {selectedVendor ? (
              <Card className="p-4 h-fit sticky top-4 max-h-[calc(100vh-140px)] overflow-y-auto">
                <div className="text-center mb-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Icon name="building" className="text-gray-500 text-2xl" />
                  </div>
                  <h3 className="font-semibold text-gray-900">{vendorProfile?.name || selectedVendor.name}</h3>
                  <p className="text-sm text-gray-500">{vendorProfile?.category || selectedVendor.category}</p>
                  <div className="flex justify-center mt-2">{renderStars(vendorProfile?.rating || selectedVendor.rating)}</div>
                  <div className="mt-2">
                    <Badge className={getStatusColor(vendorProfile?.status || selectedVendor.status || 'active')}>{vendorProfile?.status || selectedVendor.status || 'active'}</Badge>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Contact</p>
                    <p className="text-sm font-medium">{vendorProfile?.contact_name || vendorProfile?.contact || selectedVendor.contact || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Phone</p>
                    <p className="text-sm">{vendorProfile?.phone || selectedVendor.phone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Email</p>
                    <p className="text-sm text-brand-600">{vendorProfile?.email || selectedVendor.email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Address</p>
                    <p className="text-sm">{vendorProfile?.address || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Payment Terms</p>
                    <p className="text-sm">{vendorProfile?.payment_terms || '—'}</p>
                  </div>
                  {vendorSummaryLoading ? (
                    <p className="text-xs text-gray-500">Loading vendor summary...</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-gray-500">Open POs</p>
                        <p className="text-sm font-semibold text-gray-900">{Number(vendorMetrics.open_po_count || 0)}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-gray-500">30d Spend</p>
                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(Number(vendorMetrics.total_spend_30d || 0))}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-gray-500">Avg Delivery</p>
                        <p className="text-sm font-semibold text-gray-900">{Number(vendorMetrics.avg_delivery_days || 0)}d</p>
                      </div>
                    </div>
                  )}
                  {vendorOpenPOs.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Open Purchase Orders</p>
                      <div className="space-y-1">
                        {vendorOpenPOs.map((po) => (
                          <p key={po.id} className="text-xs text-gray-600">#{String(po.id).slice(0, 8)} · {po.status}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {vendorDocuments.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Recent Documents</p>
                      <div className="space-y-1">
                        {vendorDocuments.map((doc) => (
                          <a
                            key={doc.id}
                            href={doc.href || '#'}
                            target={doc.href ? '_blank' : undefined}
                            rel={doc.href ? 'noreferrer' : undefined}
                            className={`block text-xs truncate ${doc.href ? 'text-brand-600 hover:underline' : 'text-gray-500'}`}
                          >
                            {doc.fileName || 'document'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {vendorProfile?.notes && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Notes</p>
                      <p className="text-sm whitespace-pre-wrap">{vendorProfile.notes}</p>
                    </div>
                  )}
                  {formError && <p className="text-sm text-red-600">{formError}</p>}
                  {vendorSummaryError && <p className="text-sm text-red-600">{vendorSummaryError}</p>}
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => openEditModal(selectedVendor)}>
                      <Icon name="pen-to-square" className="mr-1" />Edit
                    </Button>
                    <Button variant="danger" size="sm" className="flex-1" onClick={handleDeleteVendor} disabled={deleteLoading}>
                      <Icon name={deleteLoading ? 'spinner' : 'trash'} className={`mr-1 ${deleteLoading ? 'animate-spin' : ''}`} />
                      Delete
                    </Button>
                  </div>
                  <div className="flex gap-2 pt-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        const phone = String(vendorProfile?.phone || selectedVendor?.phone || '').trim();
                        if (!phone) return;
                        window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
                      }}
                    >
                      <Icon name="phone" className="mr-1" />Call
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        const email = String(vendorProfile?.email || selectedVendor?.email || '').trim();
                        if (!email) return;
                        window.location.href = `mailto:${email}`;
                      }}
                    >
                      <Icon name="envelope" className="mr-1" />Email
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => handleSetVendorStatus('preferred')}>
                      <Icon name="star" className="mr-2" />Preferred
                    </Button>
                    <Button variant="secondary" className="flex-1" onClick={() => handleSetVendorStatus('on_hold')}>
                      <Icon name="pause" className="mr-2" />On Hold
                    </Button>
                  </div>
                  <Button variant="brand" className="w-full" onClick={openCreatePoModal}>
                    <Icon name="file-invoice" className="mr-2" />New Order
                  </Button>
                  <AttachmentPanel entityType="vendor" entityId={selectedVendor.id} />
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="building" className="text-4xl mb-2 text-gray-300" />
                <p>Select a vendor to view details</p>
              </Card>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Purchase Orders</h3>
                <Button variant="brand" size="sm" onClick={openCreatePoModal}>
                  <Icon name="plus" className="mr-2" />New PO
                </Button>
              </div>
              {purchaseOrdersLoading ? (
                <Card className="p-4"><p className="text-sm text-gray-500">Loading purchase orders...</p></Card>
              ) : purchaseOrders.length === 0 ? (
                <Card className="p-4"><p className="text-sm text-gray-500">No purchase orders yet.</p></Card>
              ) : (
                purchaseOrders.map((po) => {
                  const vendor = vendors.find((v) => String(v.id) === String(po.vendor_id));
                  const job = jobs.find((j) => String(j.id) === String(po.job_id));
                  return (
                    <Card
                      key={po.id}
                      className={`p-4 cursor-pointer transition-all ${selectedPoId === po.id ? 'ring-2 ring-brand-500' : 'hover:shadow-md'}`}
                      onClick={() => setSelectedPoId(po.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">PO #{String(po.id).slice(0, 8)}</p>
                          <p className="text-sm text-gray-500">{vendor?.name || 'Unknown Vendor'}</p>
                          <p className="text-xs text-gray-500">{job?.name || 'No Job'}</p>
                        </div>
                        <Badge className={getStatusColor(po.status || 'draft')}>{po.status || 'draft'}</Badge>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>

            {selectedPO ? (
              <Card className="p-4 h-fit sticky top-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">PO Details</h3>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openEditPoModal(selectedPO)}>
                      <Icon name="pen-to-square" />
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleDeletePO} disabled={poLoading}>
                      <Icon name={poLoading ? 'spinner' : 'trash'} className={poLoading ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{selectedPO.notes || 'No notes'}</p>

                <div>
                  <p className="text-xs text-gray-500 mb-2">Line Items</p>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {poItemsLoading ? (
                      <p className="text-sm text-gray-500">Loading items...</p>
                    ) : poItems.length === 0 ? (
                      <p className="text-sm text-gray-500">No items yet.</p>
                    ) : poItems.map((item) => {
                      const inv = inventory.find((row) => String(row.id) === String(item.inventory_id));
                      return (
                        <div key={item.id} className="border border-gray-200 rounded-lg p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{inv?.name || item.description || 'Line item'}</p>
                              <p className="text-xs text-gray-500">{item.quantity} x {formatCurrency(item.unit_cost)}</p>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="secondary" size="sm" onClick={() => handleEditPoItem(item)}><Icon name="pen-to-square" /></Button>
                              <Button variant="secondary" size="sm" onClick={() => handleDeletePoItem(item.id)}><Icon name="trash" /></Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500">{editingPoItemId ? 'Edit Line Item' : 'Add Line Item'}</p>
                  <select
                    value={poItemForm.inventory_id}
                    onChange={(e) => setPoItemForm({ ...poItemForm, inventory_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select inventory (optional)</option>
                    {inventory.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={poItemForm.description}
                    onChange={(e) => setPoItemForm({ ...poItemForm, description: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Description"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={poItemForm.quantity}
                      onChange={(e) => setPoItemForm({ ...poItemForm, quantity: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Qty"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={poItemForm.unit_cost}
                      onChange={(e) => setPoItemForm({ ...poItemForm, unit_cost: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Unit Cost"
                    />
                  </div>
                  {poError && <p className="text-sm text-red-600">{poError}</p>}
                  <Button variant="brand" size="sm" onClick={handleSavePoItem} disabled={poItemLoading}>
                    <Icon name={poItemLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${poItemLoading ? 'animate-spin' : ''}`} />
                    {editingPoItemId ? 'Save Item' : 'Add Item'}
                  </Button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-gray-500">
                <Icon name="file-invoice" className="text-4xl mb-2 text-gray-300" />
                <p>Select a purchase order to view details</p>
              </Card>
            )}
          </div>

          {showVendorModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closeModal} aria-label="Close vendor modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{editingVendorId ? 'Edit Vendor' : 'Add Vendor'}</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={closeModal}>
                    <Icon name="xmark" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Name</p>
                    <input type="text" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select value={vendorForm.status} onChange={(e) => setVendorForm({ ...vendorForm, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="active">active</option>
                      <option value="preferred">preferred</option>
                      <option value="on_hold">on_hold</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Category</p>
                    <input type="text" value={vendorForm.category} onChange={(e) => setVendorForm({ ...vendorForm, category: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Contact</p>
                    <input type="text" value={vendorForm.contact_name} onChange={(e) => setVendorForm({ ...vendorForm, contact_name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Phone</p>
                    <input type="text" value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Email</p>
                    <input type="email" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Address</p>
                    <input type="text" value={vendorForm.address} onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Payment Terms</p>
                    <input type="text" value={vendorForm.payment_terms} onChange={(e) => setVendorForm({ ...vendorForm, payment_terms: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Rating</p>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={vendorForm.rating}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
                        setVendorForm({ ...vendorForm, rating: normalized });
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Active Orders</p>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={vendorForm.active_orders}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        const normalized = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
                        setVendorForm({ ...vendorForm, active_orders: normalized });
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <textarea value={vendorForm.notes} onChange={(e) => setVendorForm({ ...vendorForm, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24" />
                  </div>
                </div>

                {formError && <p className="text-sm text-red-600 mt-4">{formError}</p>}

                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={closeModal}>Cancel</Button>
                  <Button variant="brand" onClick={handleSaveVendor} disabled={saveLoading}>
                    <Icon name={saveLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${saveLoading ? 'animate-spin' : ''}`} />
                    {editingVendorId ? 'Save Vendor' : 'Create Vendor'}
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {showPoModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button className="absolute inset-0 bg-black/40" onClick={closePoModal} aria-label="Close purchase order modal" />
              <Card className="relative z-10 w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">{editingPoId ? 'Edit Purchase Order' : 'Create Purchase Order'}</h3>
                  <button className="text-gray-500 hover:text-gray-700" onClick={closePoModal}>
                    <Icon name="xmark" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Vendor</p>
                    <select value={poForm.vendor_id} onChange={(e) => setPoForm({ ...poForm, vendor_id: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="">Select vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Job (optional)</p>
                    <select value={poForm.job_id} onChange={(e) => setPoForm({ ...poForm, job_id: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="">No job</option>
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>{job.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <select value={poForm.status} onChange={(e) => setPoForm({ ...poForm, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="draft">draft</option>
                      <option value="submitted">submitted</option>
                      <option value="approved">approved</option>
                      <option value="ordered">ordered</option>
                      <option value="received">received</option>
                      <option value="canceled">canceled</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Notes</p>
                    <textarea value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm h-24" />
                  </div>
                </div>
                {poError && <p className="text-sm text-red-600 mt-4">{poError}</p>}
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="secondary" onClick={closePoModal}>Cancel</Button>
                  <Button variant="brand" onClick={handleSavePO} disabled={poLoading}>
                    <Icon name={poLoading ? 'spinner' : 'floppy-disk'} className={`mr-2 ${poLoading ? 'animate-spin' : ''}`} />
                    {editingPoId ? 'Save PO' : 'Create PO'}
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // FINANCE VIEW (QBO Integration Placeholder)
    // ============================================
    const FinanceView = ({ jobs = [], bids = [], vendors = [], inventory = [], workOrders = [], currentRole }) => {
      const normalizedRole = String(currentRole || '').trim().toLowerCase();
      const canViewPricingSettings = normalizedRole === 'executive' || normalizedRole === 'admin' || normalizedRole === 'pm' || normalizedRole.includes('operations');
      const [pricingLoading, setPricingLoading] = useState(true);
      const [pricingSaving, setPricingSaving] = useState(false);
      const [pricingError, setPricingError] = useState('');
      const [pricingSuccess, setPricingSuccess] = useState('');
      const [pricingSettings, setPricingSettings] = useState({
        operator_labor_rate: 0,
        labor_burden_percent: 0,
        hauling_rate_per_hour: 0,
        dump_fee_per_load: 0,
        target_margin_percent: 0,
        contingency_percent: 0,
        markup_percent: 0,
      });

      useEffect(() => {
        if (!canViewPricingSettings) {
          setPricingLoading(false);
          setPricingError('');
          return () => {};
        }

        let isMounted = true;

        const loadPricingSettings = async () => {
          try {
            setPricingLoading(true);
            const response = await fetch('/api/pricing-settings', { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to load pricing settings');
            }

            if (isMounted && payload?.pricing_settings) {
              setPricingSettings({
                operator_labor_rate: Number(payload.pricing_settings.operator_labor_rate) || 0,
                labor_burden_percent: Number(payload.pricing_settings.labor_burden_percent) || 0,
                hauling_rate_per_hour: Number(payload.pricing_settings.hauling_rate_per_hour) || 0,
                dump_fee_per_load: Number(payload.pricing_settings.dump_fee_per_load) || 0,
                target_margin_percent: Number(payload.pricing_settings.target_margin_percent) || 0,
                contingency_percent: Number(payload.pricing_settings.contingency_percent) || 0,
                markup_percent: Number(payload.pricing_settings.markup_percent) || 0,
              });
            }
          } catch (error) {
            if (isMounted) {
              setPricingError(error instanceof Error ? error.message : 'Failed to load pricing settings');
            }
          } finally {
            if (isMounted) {
              setPricingLoading(false);
            }
          }
        };

        loadPricingSettings();
        return () => {
          isMounted = false;
        };
      }, [canViewPricingSettings]);

      const handleSavePricingSettings = async () => {
        try {
          setPricingSaving(true);
          setPricingError('');
          setPricingSuccess('');

          const response = await fetch('/api/pricing-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operator_labor_rate: Number(pricingSettings.operator_labor_rate) || 0,
              labor_burden_percent: Number(pricingSettings.labor_burden_percent) || 0,
              hauling_rate_per_hour: Number(pricingSettings.hauling_rate_per_hour) || 0,
              dump_fee_per_load: Number(pricingSettings.dump_fee_per_load) || 0,
              target_margin_percent: Number(pricingSettings.target_margin_percent) || 0,
              contingency_percent: Number(pricingSettings.contingency_percent) || 0,
              markup_percent: Number(pricingSettings.markup_percent) || 0,
            }),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.pricing_settings) {
            setPricingError(payload?.error || raw || 'Failed to save pricing settings');
            setPricingSaving(false);
            return;
          }

          setPricingSettings({
            operator_labor_rate: Number(payload.pricing_settings.operator_labor_rate) || 0,
            labor_burden_percent: Number(payload.pricing_settings.labor_burden_percent) || 0,
            hauling_rate_per_hour: Number(payload.pricing_settings.hauling_rate_per_hour) || 0,
            dump_fee_per_load: Number(payload.pricing_settings.dump_fee_per_load) || 0,
            target_margin_percent: Number(payload.pricing_settings.target_margin_percent) || 0,
            contingency_percent: Number(payload.pricing_settings.contingency_percent) || 0,
            markup_percent: Number(payload.pricing_settings.markup_percent) || 0,
          });
          setPricingSuccess('Pricing settings saved.');
        } catch {
          setPricingError('Failed to save pricing settings');
        } finally {
          setPricingSaving(false);
        }
      };

      const activeJobs = jobs.filter((job) => String(job?.status || "").toLowerCase() !== "completed");
      const completedJobs = jobs.filter((job) => String(job?.status || "").toLowerCase() === "completed");
      const totalPipelineValue = bids.reduce((sum, bid) => sum + Number(bid?.total || 0), 0);
      const wonBids = bids.filter((bid) => String(bid?.status || "").toLowerCase() === "won");
      const pricedBids = bids.filter((bid) => Number(bid?.total || 0) > 0);
      const avgEstimatedMarginPct =
        pricedBids.length > 0
          ? pricedBids.reduce((sum, bid) => {
              const revenue = Number(bid?.total || 0);
              const estCost = Number(bid?.estimatedCost || 0);
              if (revenue <= 0) return sum;
              return sum + ((revenue - estCost) / revenue) * 100;
            }, 0) / pricedBids.length
          : 0;
      const openWorkOrders = workOrders.filter((wo) => String(wo?.status || "").toLowerCase() !== "completed").length;
      const lowStockItems = inventory.filter((item) => Number(item?.qtyOnHand || 0) <= Number(item?.reorderPoint || 0)).length;
      const activeVendors = vendors.filter((vendor) => String(vendor?.status || "").toLowerCase() !== "on_hold").length;
      const pendingVendorApprovals = vendors.filter((vendor) => String(vendor?.status || "").toLowerCase() === "preferred").length;

      const revenueToDate = activeJobs.reduce((sum, job) => sum + Number(job?.budget || 0), 0);
      const spentToDate = activeJobs.reduce((sum, job) => sum + Number(job?.spent || 0), 0);
      const projectedCashGap = spentToDate - revenueToDate;
      const utilizationPct = revenueToDate > 0 ? Math.min(100, Math.round((spentToDate / revenueToDate) * 100)) : 0;

      const exceptions = [
        {
          key: "low_stock",
          label: "Low inventory alerts",
          value: lowStockItems,
          severity: lowStockItems > 0 ? "warn" : "ok",
        },
        {
          key: "open_work_orders",
          label: "Open work orders",
          value: openWorkOrders,
          severity: openWorkOrders > 0 ? "warn" : "ok",
        },
        {
          key: "unpriced_bids",
          label: "Bids with no total",
          value: bids.filter((bid) => Number(bid?.total || 0) <= 0).length,
          severity: bids.some((bid) => Number(bid?.total || 0) <= 0) ? "warn" : "ok",
        },
      ];

      const topJobsBySpend = [...jobs]
        .map((job) => ({
          id: job?.id,
          name: job?.name || "Job",
          budget: Number(job?.budget || 0),
          spent: Number(job?.spent || 0),
        }))
        .sort((a, b) => b.spent - a.spent)
        .slice(0, 5)
        .map((job) => {
          const remaining = job.budget - job.spent;
          const marginPct = job.budget > 0 ? ((job.budget - job.spent) / job.budget) * 100 : 0;
          return {
            ...job,
            remaining,
            marginPct,
          };
        });

      return (
        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/20 rounded-xl flex items-center justify-center">
                  <Icon name="plug" className="text-3xl" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Accounting Integration</h3>
                  <p className="text-blue-100">Not configured yet</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  className="px-6 py-3 bg-white/20 text-white font-semibold rounded-lg opacity-60 cursor-not-allowed flex items-center gap-2"
                  disabled
                >
                  <Icon name="link" /> Connect QuickBooks
                </button>
                <button
                  className="px-6 py-3 bg-white/20 text-white font-semibold rounded-lg opacity-60 cursor-not-allowed flex items-center gap-2"
                  disabled
                >
                  <Icon name="rotate" /> Sync Now
                </button>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-gray-900 mb-2">
              <Icon name="chart-line" className="mr-2 text-brand-500" />
              Financial KPIs
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Pipeline Value</p>
                <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalPipelineValue)}</p>
                <p className="text-xs text-gray-500">{bids.length} opportunities</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Win Rate</p>
                <p className="text-lg font-semibold text-gray-900">
                  {bids.length > 0 ? `${Math.round((wonBids.length / bids.length) * 100)}%` : "0%"}
                </p>
                <p className="text-xs text-gray-500">{wonBids.length} won / {bids.length} total</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Avg Estimated Margin</p>
                <p className="text-lg font-semibold text-gray-900">{avgEstimatedMarginPct.toFixed(1)}%</p>
                <p className="text-xs text-gray-500">Estimate quality signal</p>
              </div>
              <div className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                <p className="text-xs text-gray-500">Active vs Completed Jobs</p>
                <p className="text-lg font-semibold text-gray-900">{activeJobs.length} / {completedJobs.length}</p>
                <p className="text-xs text-gray-500">Operational load</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">
                <Icon name="money-bill-transfer" className="mr-2 text-brand-500" />
                Accounts Overview
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Revenue to Date (internal)</span>
                  <span className="font-medium text-gray-900">{formatCurrency(revenueToDate)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Spent to Date (internal)</span>
                  <span className="font-medium text-gray-900">{formatCurrency(spentToDate)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Projected Cash Gap</span>
                  <span className={`font-medium ${projectedCashGap > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(projectedCashGap)}
                  </span>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Budget Utilization</span>
                    <span>{utilizationPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div className={`h-full ${utilizationPct > 85 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${utilizationPct}%` }} />
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-4">
                <Icon name="receipt" className="mr-2 text-brand-500" />
                Exception Feed
              </h3>
              <div className="space-y-2">
                {exceptions.map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${item.severity === "warn" ? "bg-amber-500" : "bg-green-500"}`} />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{item.value}</span>
                  </div>
                ))}
                <div className="pt-2 text-xs text-gray-500">
                  Vendors active: {activeVendors} • Preferred vendors: {pendingVendorApprovals}
                </div>
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="font-semibold text-gray-900 mb-4">
              <Icon name="chart-simple" className="mr-2 text-brand-500" />
              Job Profitability
            </h3>
            {topJobsBySpend.length === 0 ? (
              <p className="text-sm text-gray-500">No jobs available yet.</p>
            ) : (
              <div className="space-y-2">
                {topJobsBySpend.map((job) => (
                  <div key={job.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <div className="md:col-span-2">
                      <p className="font-medium text-gray-900 truncate">{job.name}</p>
                    </div>
                    <div className="text-gray-600">Budget: <span className="font-medium text-gray-900">{formatCurrency(job.budget)}</span></div>
                    <div className="text-gray-600">Spent: <span className="font-medium text-gray-900">{formatCurrency(job.spent)}</span></div>
                    <div className="text-gray-600">
                      Margin: <span className={`font-medium ${job.marginPct < 15 ? "text-red-600" : "text-green-600"}`}>{job.marginPct.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {canViewPricingSettings && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                <Icon name="sliders" className="mr-2 text-brand-500" />
                Pricing Settings
              </h3>
              <Button variant="brand" size="sm" onClick={handleSavePricingSettings} disabled={pricingSaving || pricingLoading}>
                <Icon name={pricingSaving ? 'spinner' : 'floppy-disk'} className={`mr-2 ${pricingSaving ? 'animate-spin' : ''}`} />
                {pricingSaving ? 'Saving...' : 'Save Rates'}
              </Button>
            </div>
            {pricingLoading ? (
              <p className="text-sm text-gray-500">Loading pricing settings...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Operator Labor Rate</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.operator_labor_rate}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, operator_labor_rate: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Labor Burden %</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.labor_burden_percent}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, labor_burden_percent: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Hauling Rate / Hour</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.hauling_rate_per_hour}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, hauling_rate_per_hour: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Dump Fee / Load</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.dump_fee_per_load}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, dump_fee_per_load: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Target Margin %</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.target_margin_percent}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, target_margin_percent: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Contingency %</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.contingency_percent}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, contingency_percent: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Markup %</p>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={pricingSettings.markup_percent}
                    onChange={(e) => setPricingSettings({ ...pricingSettings, markup_percent: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}
            {pricingError && <p className="text-sm text-red-600 mt-3">{pricingError}</p>}
            {pricingSuccess && <p className="text-sm text-green-600 mt-3">{pricingSuccess}</p>}
          </Card>
          )}
        </div>
      );
    };

    // ============================================
    // SUBSCRIBE VIEW
    // ============================================
    const SubscribeView = ({ employees = [], currentRole }) => {
      const isAdmin = currentRole === 'executive';
      const [billingStatus, setBillingStatus] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [actionLoading, setActionLoading] = useState('');
      const [actionMessage, setActionMessage] = useState('');
      const [selectedPlan, setSelectedPlan] = useState('starter');

      const pricingByPlan = {
        starter: { label: 'Starter', seatPrice: 49 },
        professional: { label: 'Professional', seatPrice: 79 },
      };

      const billableEmployees = (employees || []).filter((employee) => String(employee?.status || '').toLowerCase() !== 'inactive');
      const seatCount = Math.max(1, Number(billableEmployees.length || 0));
      const currentPlanKey = String(billingStatus?.plan_type || selectedPlan || 'starter');
      const selectedSeatPrice = pricingByPlan[selectedPlan]?.seatPrice || pricingByPlan.starter.seatPrice;
      const currentSeatPrice = pricingByPlan[currentPlanKey]?.seatPrice || selectedSeatPrice;
      const estimatedMonthly = seatCount * currentSeatPrice;

      useEffect(() => {
        let active = true;
        const load = async () => {
          try {
            setLoading(true);
            setError('');
            const response = await fetch('/api/billing/status', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!active) return;
            if (!response.ok) {
              setError(payload?.error || 'Failed to load subscription status');
              return;
            }
            setBillingStatus(payload?.item || null);
            const loadedPlan = String(payload?.item?.plan_type || '');
            if (loadedPlan && pricingByPlan[loadedPlan]) {
              setSelectedPlan(loadedPlan);
            }
          } catch {
            if (active) setError('Failed to load subscription status');
          } finally {
            if (active) setLoading(false);
          }
        };
        load();
        return () => {
          active = false;
        };
      }, []);

      const handleBillingAction = async (path) => {
        try {
          setActionLoading(path);
          setActionMessage('');
          setError('');
          const response = await fetch(path, { method: 'POST' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            const reason = payload?.error || 'Billing action failed';
            setError(reason);
            return;
          }
          setActionMessage(
            path.includes('/checkout')
              ? 'Checkout session requested. Once Stripe is configured, this will redirect to checkout.'
              : 'Billing portal requested. Once Stripe is configured, this will open customer billing portal.'
          );
        } catch {
          setError('Billing action failed');
        } finally {
          setActionLoading('');
        }
      };

      if (!isAdmin) {
        return (
          <Card className="p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Subscribe</h3>
            <p className="text-sm text-gray-600">Only the company admin can access subscription settings.</p>
          </Card>
        );
      }

      return (
        <div className="space-y-6">
          <StatGrid>
            <StatCard
              icon="users"
              iconBgColor="bg-brand-100"
              iconColor="text-brand-500"
              value={seatCount}
              label="Active Employee Seats"
            />
            <StatCard
              icon="dollar-sign"
              iconBgColor="bg-green-100"
              iconColor="text-green-600"
              value={formatCurrency(currentSeatPrice)}
              label="Price Per Seat / Month"
            />
            <StatCard
              icon="receipt"
              iconBgColor="bg-blue-100"
              iconColor="text-blue-600"
              value={formatCurrency(estimatedMonthly)}
              label="Estimated Monthly Total"
            />
            <StatCard
              icon="credit-card"
              iconBgColor="bg-yellow-100"
              iconColor="text-yellow-600"
              value={String(billingStatus?.subscription_status || 'inactive')}
              label="Current Subscription Status"
            />
          </StatGrid>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Company Subscription</h3>
              {loading && <span className="text-xs text-gray-500">Loading status...</span>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Plan</p>
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="starter">Starter - $49 / user / mo</option>
                  <option value="professional">Professional - $79 / user / mo</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Current Plan Type</p>
                <input
                  value={String(billingStatus?.plan_type || 'starter')}
                  readOnly
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Seat Count Used</p>
                <input
                  value={String(seatCount)}
                  readOnly
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Projected Monthly Charge</p>
                <input
                  value={formatCurrency(estimatedMonthly)}
                  readOnly
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                />
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-600">
                Billing model: <span className="font-medium text-gray-800">per employee seat</span>. Billable seats are active team members.
                Current estimate: <span className="font-semibold text-gray-900">{seatCount}</span> seats ×
                <span className="font-semibold text-gray-900"> {formatCurrency(currentSeatPrice)}</span> ={' '}
                <span className="font-semibold text-gray-900">{formatCurrency(estimatedMonthly)}/mo</span>.
              </p>
            </div>
            <div className="flex gap-2 mt-5">
              <Button
                variant="brand"
                onClick={() => handleBillingAction('/api/billing/checkout')}
                disabled={actionLoading === '/api/billing/checkout'}
              >
                <Icon name={actionLoading === '/api/billing/checkout' ? 'spinner' : 'credit-card'} className={`mr-2 ${actionLoading === '/api/billing/checkout' ? 'animate-spin' : ''}`} />
                Start Seat Subscription
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleBillingAction('/api/billing/portal')}
                disabled={actionLoading === '/api/billing/portal'}
              >
                <Icon name={actionLoading === '/api/billing/portal' ? 'spinner' : 'arrow-up-right-from-square'} className={`mr-2 ${actionLoading === '/api/billing/portal' ? 'animate-spin' : ''}`} />
                Manage Billing
              </Button>
            </div>
            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
            {actionMessage && <p className="text-sm text-green-600 mt-4">{actionMessage}</p>}
          </Card>
        </div>
      );
    };

    // ============================================
    // SETTINGS VIEW
    // ============================================
    const SettingsView = ({ employees = [], currentUser, currentRole }) => {
      const isAdmin = currentRole === 'executive';
      const [activeTab, setActiveTab] = useState('company');
      const [billingStatus, setBillingStatus] = useState(null);
      const [integrations, setIntegrations] = useState([]);
      const [settingsLoading, setSettingsLoading] = useState(false);
      const [settingsError, setSettingsError] = useState('');
      const [pricingLoading, setPricingLoading] = useState(false);
      const [pricingSaving, setPricingSaving] = useState(false);
      const [pricingError, setPricingError] = useState('');
      const [pricingSuccess, setPricingSuccess] = useState('');
      const [pricingSettings, setPricingSettings] = useState({
        operator_labor_rate: 0,
        labor_burden_percent: 0,
        hauling_rate_per_hour: 0,
        dump_fee_per_load: 0,
        target_margin_percent: 0,
        contingency_percent: 0,
        markup_percent: 0,
      });

      useEffect(() => {
        let active = true;
        const load = async () => {
          try {
            setSettingsLoading(true);
            setSettingsError('');
            const [billingRes, integrationsRes] = await Promise.all([
              fetch('/api/billing/status', { cache: 'no-store' }),
              fetch('/api/integrations', { cache: 'no-store' }),
            ]);
            const billingPayload = await billingRes.json().catch(() => ({}));
            const integrationsPayload = await integrationsRes.json().catch(() => ({}));
            if (!active) return;
            if (billingRes.ok) setBillingStatus(billingPayload?.item || null);
            if (integrationsRes.ok) setIntegrations(integrationsPayload?.items || []);
            if (!billingRes.ok && !integrationsRes.ok) {
              setSettingsError(billingPayload?.error || integrationsPayload?.error || 'Failed to load settings data');
            }
          } catch {
            if (active) setSettingsError('Failed to load settings data');
          } finally {
            if (active) setSettingsLoading(false);
          }
        };
        load();
        return () => {
          active = false;
        };
      }, []);

      useEffect(() => {
        let active = true;
        const loadPricing = async () => {
          try {
            setPricingLoading(true);
            const response = await fetch('/api/pricing-settings', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!active) return;
            if (!response.ok) return;
            const row = payload?.pricing_settings || {};
            setPricingSettings({
              operator_labor_rate: Number(row.operator_labor_rate) || 0,
              labor_burden_percent: Number(row.labor_burden_percent) || 0,
              hauling_rate_per_hour: Number(row.hauling_rate_per_hour) || 0,
              dump_fee_per_load: Number(row.dump_fee_per_load) || 0,
              target_margin_percent: Number(row.target_margin_percent) || 0,
              contingency_percent: Number(row.contingency_percent) || 0,
              markup_percent: Number(row.markup_percent) || 0,
            });
          } finally {
            if (active) setPricingLoading(false);
          }
        };
        loadPricing();
        return () => {
          active = false;
        };
      }, []);

      const savePricingSettings = async () => {
        try {
          setPricingSaving(true);
          setPricingError('');
          setPricingSuccess('');
          const response = await fetch('/api/pricing-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pricingSettings),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setPricingError(payload?.error || 'Failed to save pricing settings');
            return;
          }
          setPricingSuccess('Pricing settings saved.');
        } catch {
          setPricingError('Failed to save pricing settings');
        } finally {
          setPricingSaving(false);
        }
      };

      const teamByRole = employees.reduce((acc, emp) => {
        const key = String(emp?.role || 'operator').toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      const connectedIntegrations = integrations.filter((item) => item.connected).length;

      return (
        <div className="space-y-6">
          <Tabs
            tabs={[
              { id: 'company', label: 'Company', icon: 'building' },
              { id: 'users', label: 'Users & Roles', icon: 'users' },
              { id: 'billing', label: 'Billing', icon: 'credit-card' },
              { id: 'integrations', label: 'Integrations', icon: 'plug' },
              { id: 'pricing', label: 'Pricing Defaults', icon: 'sliders' },
              { id: 'security', label: 'Security', icon: 'shield-halved' },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
          />

          {settingsError && <InlineError>{settingsError}</InlineError>}

          {activeTab === 'company' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-4 lg:col-span-2">
                <h3 className="font-semibold text-gray-900 mb-3">Company Profile</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Company Name</p>
                    <p className="font-medium text-gray-900">{currentUser?.company || 'My Company'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Primary Admin</p>
                    <p className="font-medium text-gray-900">{currentUser?.name || 'Admin User'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Admin Email</p>
                    <p className="font-medium text-gray-900 break-all">{currentUser?.email || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Timezone</p>
                    <p className="font-medium text-gray-900">America/New_York</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-3">System Snapshot</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Team Members</span><span className="font-medium">{employees.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Connected Integrations</span><span className="font-medium">{connectedIntegrations}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Billing Active</span><span className="font-medium">{billingStatus?.is_active ? 'Yes' : 'No'}</span></div>
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'users' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Users & Roles</h3>
              <p className="text-sm text-gray-500 mb-4">
                Role changes and invites are managed through Team. Only CEO/admin can change role permissions.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                {['admin', 'pm', 'foreman', 'mechanic', 'operator'].map((role) => (
                  <div key={role} className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs uppercase text-gray-500">{role}</p>
                    <p className="text-xl font-semibold text-gray-900">{Number(teamByRole[role] || 0)}</p>
                  </div>
                ))}
              </div>
              <Button variant="secondary" onClick={() => setCurrentView('team')}>
                <Icon name="arrow-right" className="mr-2" />
                Open Team Management
              </Button>
            </Card>
          )}

          {activeTab === 'billing' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Billing & Subscription</h3>
              {settingsLoading ? (
                <p className="text-sm text-gray-500">Loading billing status...</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Plan</p>
                    <p className="font-medium">{String(billingStatus?.plan_type || 'starter')}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Subscription Status</p>
                    <p className="font-medium">{String(billingStatus?.subscription_status || 'inactive')}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Trial Ends</p>
                    <p className="font-medium">{billingStatus?.trial_ends_at ? formatDate(billingStatus.trial_ends_at) : '—'}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Current Period End</p>
                    <p className="font-medium">{billingStatus?.current_period_end ? formatDate(billingStatus.current_period_end) : '—'}</p>
                  </div>
                </div>
              )}
            </Card>
          )}

          {activeTab === 'integrations' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Integrations Health</h3>
              <div className="space-y-2">
                {(integrations || []).slice(0, 10).map((item) => (
                  <div key={item.provider} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                    <span className="text-sm text-gray-700 capitalize">{item.provider}</span>
                    <Badge className={item.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}>
                      {item.connected ? 'Connected' : 'Not connected'}
                    </Badge>
                  </div>
                ))}
                {integrations.length === 0 && <p className="text-sm text-gray-500">No integrations configured yet.</p>}
              </div>
            </Card>
          )}

          {activeTab === 'pricing' && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Pricing Defaults</h3>
                <Button variant="brand" size="sm" onClick={savePricingSettings} disabled={!isAdmin || pricingSaving || pricingLoading}>
                  {pricingSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['operator_labor_rate', 'Operator Labor Rate'],
                  ['labor_burden_percent', 'Labor Burden %'],
                  ['hauling_rate_per_hour', 'Hauling Rate / Hour'],
                  ['dump_fee_per_load', 'Dump Fee / Load'],
                  ['target_margin_percent', 'Target Margin %'],
                  ['contingency_percent', 'Contingency %'],
                  ['markup_percent', 'Markup %'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <input
                      type="number"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      value={pricingSettings[key]}
                      disabled={!isAdmin}
                      onChange={(e) => setPricingSettings((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                    />
                  </div>
                ))}
              </div>
              {pricingError && <p className="text-sm text-red-600 mt-3">{pricingError}</p>}
              {pricingSuccess && <p className="text-sm text-green-600 mt-3">{pricingSuccess}</p>}
              {!isAdmin && <p className="text-xs text-gray-500 mt-3">Read-only. Only CEO/admin can save pricing defaults.</p>}
            </Card>
          )}

          {activeTab === 'security' && (
            <Card className="p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Security & Access Policy</h3>
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium text-gray-900">Role switching policy</p>
                  <p className="text-gray-600 mt-1">Only CEO/admin can use role-view switching. All other users are locked to assigned role.</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium text-gray-900">Employee role changes</p>
                  <p className="text-gray-600 mt-1">Role promotions/demotions are admin-only and enforced server-side.</p>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="font-medium text-gray-900">Invite flow</p>
                  <p className="text-gray-600 mt-1">Invite links are tokenized, email-bound, and single-use with expiration.</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      );
    };

    // ============================================
    // AUDIT VIEW
    // ============================================
    const AuditView = ({ currentRole }) => {
      const canViewAudit = currentRole === 'executive' || currentRole === 'operations';
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [events, setEvents] = useState([]);
      const [selectedEventId, setSelectedEventId] = useState(null);
      const [search, setSearch] = useState('');
      const [actionFilter, setActionFilter] = useState('all');
      const [entityFilter, setEntityFilter] = useState('all');
      const [dateFrom, setDateFrom] = useState('');
      const [dateTo, setDateTo] = useState('');

      const loadAuditLogs = useCallback(async () => {
        if (!canViewAudit) return;
        try {
          setLoading(true);
          setError('');
          const response = await fetch('/api/audit-logs', { cache: 'no-store' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(payload?.error || 'Failed to load audit logs');
            setEvents([]);
            return;
          }
          const items = payload?.items || [];
          setEvents(items);
          if (items.length > 0) setSelectedEventId(items[0].id);
        } catch {
          setError('Failed to load audit logs');
          setEvents([]);
        } finally {
          setLoading(false);
        }
      }, [canViewAudit]);

      useEffect(() => {
        loadAuditLogs();
      }, [loadAuditLogs]);

      const actions = useMemo(
        () => ['all', ...Array.from(new Set(events.map((item) => String(item.action || 'unknown')))).sort()],
        [events]
      );

      const entities = useMemo(
        () => ['all', ...Array.from(new Set(events.map((item) => String(item.entity_type || 'system')))).sort()],
        [events]
      );

      const normalizedSearch = String(search || '').trim().toLowerCase();
      const filteredEvents = events.filter((event) => {
        if (actionFilter !== 'all' && String(event.action || '') !== actionFilter) return false;
        if (entityFilter !== 'all' && String(event.entity_type || 'system') !== entityFilter) return false;
        if (dateFrom || dateTo) {
          const stamp = String(event.created_at || '').slice(0, 10);
          if (!stamp) return false;
          if (dateFrom && stamp < dateFrom) return false;
          if (dateTo && stamp > dateTo) return false;
        }
        if (!normalizedSearch) return true;
        const haystack = [
          event.action,
          event.entity_type,
          event.entity_id,
          event.actor_user_id,
          JSON.stringify(event.metadata || {}),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      });

      const selectedEvent = filteredEvents.find((event) => String(event.id) === String(selectedEventId)) || filteredEvents[0] || null;

      const exportAuditCsv = () => {
        if (!filteredEvents.length) return;
        const rows = filteredEvents.map((event) => ({
          id: event.id,
          created_at: event.created_at || '',
          action: event.action || '',
          entity_type: event.entity_type || '',
          entity_id: event.entity_id || '',
          actor_user_id: event.actor_user_id || '',
        }));
        const headers = Object.keys(rows[0]);
        const csv = [
          headers.join(','),
          ...rows.map((row) => headers.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(',')),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'audit-log-export.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      };

      if (!canViewAudit) {
        return (
          <Card className="p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Audit</h3>
            <p className="text-sm text-gray-600">Forbidden. Audit logs are available to admin/pm only.</p>
          </Card>
        );
      }

      return (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
              <div className="xl:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Search</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Action, entity, actor, metadata"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Action</label>
                <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {actions.map((action) => (
                    <option key={action} value={action}>{action}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Entity</label>
                <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {entities.map((entity) => (
                    <option key={entity} value={entity}>{entity}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-gray-500">Showing {filteredEvents.length} of {events.length} events</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={loadAuditLogs}>
                  <Icon name="rotate" className="mr-2" />
                  Refresh
                </Button>
                <Button variant="secondary" size="sm" onClick={exportAuditCsv} disabled={!filteredEvents.length}>
                  <Icon name="file-export" className="mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>
          </Card>

          {loading ? (
            <Card className="p-4">
              <p className="text-sm text-gray-500">Loading audit logs...</p>
            </Card>
          ) : error ? (
            <InlineError>{error}</InlineError>
          ) : filteredEvents.length === 0 ? (
            <EmptyState>No audit events match your filters.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {filteredEvents.map((event) => {
                  const isSelected = selectedEvent && String(selectedEvent.id) === String(event.id);
                  return (
                    <Card
                      key={event.id}
                      className={`p-3 cursor-pointer ${isSelected ? 'ring-2 ring-brand-500' : ''}`}
                      onClick={() => setSelectedEventId(event.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-all">{event.action || 'event'}</p>
                          <p className="text-xs text-gray-500 mt-1 break-all">
                            {event.entity_type || 'system'} • {event.entity_id || '—'} • actor {event.actor_user_id || 'system'}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 whitespace-nowrap">
                          {event.created_at ? formatDate(event.created_at) : '-'}
                        </p>
                      </div>
                    </Card>
                  );
                })}
              </div>

              <Card className="p-4 h-fit sticky top-4">
                {selectedEvent ? (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-gray-900">Event Detail</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-gray-500">Action</span><span className="font-medium text-gray-900">{selectedEvent.action || '-'}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-gray-500">Entity</span><span className="font-medium text-gray-900">{selectedEvent.entity_type || '-'}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-gray-500">Entity ID</span><span className="font-medium text-gray-900 break-all">{selectedEvent.entity_id || '-'}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-gray-500">Actor</span><span className="font-medium text-gray-900 break-all">{selectedEvent.actor_user_id || '-'}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-gray-500">When</span><span className="font-medium text-gray-900">{selectedEvent.created_at ? formatDate(selectedEvent.created_at) : '-'}</span></div>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-1">Metadata</p>
                      <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto max-h-52 whitespace-pre-wrap break-all">
                        {JSON.stringify(selectedEvent.metadata || {}, null, 2)}
                      </pre>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-1">Before</p>
                      <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {JSON.stringify(selectedEvent.before_data || {}, null, 2)}
                      </pre>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-1">After</p>
                      <pre className="text-[11px] bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {JSON.stringify(selectedEvent.after_data || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Select an event to inspect details.</p>
                )}
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // MESSAGES VIEW - Team Communication Hub
    // ============================================
    const IntegrationsView = () => {
      type IntegrationCapability = {
        canConnect: boolean;
        canDisconnect: boolean;
        hasSync: boolean;
      };

      type IntegrationCatalogItem = {
        provider: string;
        name: string;
        category: string;
        icon: string;
        description: string;
        popular: boolean;
        capabilities: IntegrationCapability;
        connect_url_placeholder: string;
      };

      type IntegrationConnection = {
        id: string;
        provider: string;
        connected: boolean;
        connected_at?: string | null;
        disconnected_at?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      };

      const [searchTerm, setSearchTerm] = useState('');
      const [activeCategory, setActiveCategory] = useState('all');
      const [connections, setConnections] = useState<IntegrationConnection[]>([]);
      const [integrations, setIntegrations] = useState<IntegrationCatalogItem[]>([]);
      const [loadingConnections, setLoadingConnections] = useState(false);
      const [loadingCapabilities, setLoadingCapabilities] = useState(false);
      const [connectionsError, setConnectionsError] = useState('');
      const [activeProviderAction, setActiveProviderAction] = useState<string | null>(null);

      const loadConnections = useCallback(async () => {
        setLoadingConnections(true);
        setConnectionsError('');
        try {
          const response = await fetch('/api/integrations', { cache: 'no-store' });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }

          if (!response.ok) {
            setConnectionsError(parsed?.error || raw || 'Failed to load integrations');
            setConnections([]);
            return;
          }

          setConnections(Array.isArray(parsed?.items) ? parsed.items : []);
        } catch {
          setConnectionsError('Failed to load integrations');
          setConnections([]);
        } finally {
          setLoadingConnections(false);
        }
      }, []);

      const loadCapabilities = useCallback(async () => {
        setLoadingCapabilities(true);
        setConnectionsError('');
        try {
          const response = await fetch('/api/integrations/capabilities', { cache: 'no-store' });
          const raw = await response.text();
          let parsed: { items?: IntegrationCatalogItem[]; error?: string } = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }

          if (!response.ok) {
            setConnectionsError(parsed.error || raw || 'Failed to load integration capabilities');
            setIntegrations([]);
            return;
          }

          setIntegrations(Array.isArray(parsed.items) ? parsed.items : []);
        } catch {
          setConnectionsError('Failed to load integration capabilities');
          setIntegrations([]);
        } finally {
          setLoadingCapabilities(false);
        }
      }, []);

      useEffect(() => {
        loadConnections();
        loadCapabilities();
      }, [loadConnections, loadCapabilities]);

      const connectedIntegrations = connections
        .filter((item) => item.connected)
        .map((item) => item.provider);

      const categories = [
        { id: 'all', label: 'All Integrations', icon: 'grid-2' },
        { id: 'financial', label: 'Financial', icon: 'landmark' },
        { id: 'fleet', label: 'Fleet & GPS', icon: 'satellite-dish' },
        { id: 'time', label: 'Time & Payroll', icon: 'clock' },
        { id: 'project', label: 'Project Management', icon: 'helmet-safety' },
        { id: 'communication', label: 'Communication', icon: 'comment-sms' },
        { id: 'documents', label: 'Documents', icon: 'file-signature' },
        { id: 'weather', label: 'Weather', icon: 'cloud-sun' },
        { id: 'fuel', label: 'Fuel & Purchasing', icon: 'gas-pump' },
        { id: 'compliance', label: 'Compliance', icon: 'shield-halved' },
        { id: 'crm', label: 'CRM & Sales', icon: 'chart-line' },
      ];

      const filteredIntegrations = integrations.filter(int => {
        const matchesSearch = int.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              int.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = activeCategory === 'all' || int.category === activeCategory;
        return matchesSearch && matchesCategory;
      });

      const toggleConnection = async (id, connected) => {
        setActiveProviderAction(id);
        setConnectionsError('');
        try {
          const endpoint = connected
            ? `/api/integrations/${id}/disconnect`
            : `/api/integrations/${id}/connect`;
          const response = await fetch(endpoint, { method: 'POST' });
          const raw = await response.text();
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = {};
          }
          if (!response.ok) {
            setConnectionsError(parsed?.error || raw || 'Failed to update integration');
            return;
          }
          await loadConnections();
        } catch {
          setConnectionsError('Failed to update integration');
        } finally {
          setActiveProviderAction(null);
        }
      };

      return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Integrations</h2>
              <p className="text-sm text-gray-500">Connect your favorite tools to streamline operations</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success" className="text-sm">
                <Icon name="plug" className="mr-1" />
                {connectedIntegrations.length} Connected
              </Badge>
            </div>
          </div>

          {loadingConnections && (
            <Card className="p-4">
              <p className="text-sm text-gray-500">Loading integrations...</p>
            </Card>
          )}
          {loadingCapabilities && (
            <Card className="p-4">
              <p className="text-sm text-gray-500">Loading integration capabilities...</p>
            </Card>
          )}
          {connectionsError && (
            <Card className="p-4 border border-red-200 bg-red-50">
              <p className="text-sm text-red-700">{connectionsError}</p>
            </Card>
          )}
          {!loadingConnections && !loadingCapabilities && !connectionsError && connections.length === 0 && (
            <Card className="p-4">
              <p className="text-sm text-gray-500">No saved integrations yet.</p>
            </Card>
          )}

          {/* Search and Stats */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Icon name="magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search integrations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
          </div>

          <div className="flex gap-6">
            {/* Categories Sidebar */}
            <div className="w-56 flex-shrink-0">
              <Card className="p-2">
                <nav className="space-y-1">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                        activeCategory === cat.id
                          ? 'bg-brand-50 text-brand-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Icon name={cat.icon} className={activeCategory === cat.id ? 'text-brand-500' : 'text-gray-400'} />
                      {cat.label}
                      <span className={`ml-auto text-xs ${activeCategory === cat.id ? 'text-brand-500' : 'text-gray-400'}`}>
                        {cat.id === 'all' ? integrations.length : integrations.filter(i => i.category === cat.id).length}
                      </span>
                    </button>
                  ))}
                </nav>
              </Card>
            </div>

            {/* Integrations Grid */}
            <div className="flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredIntegrations.map(integration => {
                  const isConnected = connectedIntegrations.includes(integration.provider);
                  const isBusy = activeProviderAction === integration.provider || loadingConnections || loadingCapabilities;
                  const canConnect = integration.capabilities?.canConnect !== false;
                  const canDisconnect = integration.capabilities?.canDisconnect !== false;
                  return (
                    <Card
                      key={integration.provider}
                      data-testid={`integration-card-${integration.provider}`}
                      className={`p-4 transition-all ${isConnected ? 'ring-2 ring-green-500 bg-green-50/30' : 'hover:shadow-md'}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isConnected ? 'bg-green-100' : 'bg-gray-100'}`}>
                            <Icon name={integration.icon} className={`text-xl ${isConnected ? 'text-green-600' : 'text-gray-600'}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-gray-900">{integration.name}</h4>
                              {integration.popular && (
                                <Badge className="bg-brand-100 text-brand-700 text-xs">Popular</Badge>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 capitalize">{integration.category.replace('-', ' ')}</p>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{integration.description}</p>
                      <div className="flex items-center justify-between">
                        {isConnected ? (
                          <>
                            <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                              <Icon name="check-circle" /> Connected
                            </span>
                            <div className="flex gap-2">
                              <Button variant="secondary" size="sm">
                                <Icon name="gear" />
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => toggleConnection(integration.provider, true)}
                                disabled={isBusy || !canDisconnect}
                                data-testid={`integration-disconnect-${integration.provider}`}
                              >
                                {isBusy ? 'Saving...' : 'Disconnect'}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-sm text-gray-400">Not connected</span>
                            <Button
                              variant="brand"
                              size="sm"
                              onClick={() => toggleConnection(integration.provider, false)}
                              disabled={isBusy || !canConnect}
                              data-testid={`integration-connect-${integration.provider}`}
                            >
                              <Icon name="plug" className="mr-1" /> {isBusy ? 'Saving...' : 'Connect'}
                            </Button>
                          </>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {filteredIntegrations.length === 0 && (
                <Card className="p-12 text-center">
                  <Icon name="plug-circle-xmark" className="text-4xl text-gray-300 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No integrations found</h3>
                  <p className="text-gray-500">Try adjusting your search or category filter</p>
                </Card>
              )}
            </div>
          </div>

          {/* Integration Requests */}
          <Card className="p-6 bg-gradient-to-r from-gray-50 to-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Don't see what you need?</h3>
                <p className="text-sm text-gray-600">We're always adding new integrations. Let us know what tools you'd like to connect.</p>
              </div>
              <Button variant="secondary">
                <Icon name="paper-plane" className="mr-2" /> Request Integration
              </Button>
            </div>
          </Card>
        </div>
      );
    };

    // ============================================
    // MARKETING VIEW - Refined Marketing Co. Partnership
    // ============================================
    const MarketingView = () => {
      const [isConnected, setIsConnected] = useState(false);
      const [activeTab, setActiveTab] = useState('branding');

      // Current Plan Data
      const currentPlan = {
        name: 'Growth Partner',
        price: '$2,500/mo',
        features: ['Full Brand Management', 'Website Design & Hosting', 'Social Media Management', 'SEO & Content Strategy', 'Monthly Analytics Report', 'Dedicated Account Manager'],
        nextBilling: '2026-03-01',
        status: 'active'
      };

      // Branding Kit Assets
      const brandAssets = {
        logos: [
          { id: 1, name: 'Primary Logo (Full Color)', format: 'SVG, PNG, PDF', size: '2.4 MB' },
          { id: 2, name: 'Logo Mark (Icon Only)', format: 'SVG, PNG', size: '856 KB' },
          { id: 3, name: 'White Logo (Dark Backgrounds)', format: 'SVG, PNG, PDF', size: '2.1 MB' },
          { id: 4, name: 'Horizontal Logo', format: 'SVG, PNG', size: '1.8 MB' },
        ],
        colors: [
          { name: 'Primary Orange', hex: '#F97316', rgb: '249, 115, 22' },
          { name: 'Dark Gray', hex: '#151515', rgb: '21, 21, 21' },
          { name: 'Light Gray', hex: '#F3F4F6', rgb: '243, 244, 246' },
          { name: 'Accent Blue', hex: '#3B82F6', rgb: '59, 130, 246' },
        ],
        fonts: [
          { name: 'Inter', usage: 'Headlines & Body', weights: 'Regular, Medium, Bold' },
          { name: 'Roboto Mono', usage: 'Data & Numbers', weights: 'Regular, Medium' },
        ]
      };

      // Creative Assets
      const creativeAssets = [
        { id: 1, name: 'Social Media Templates', type: 'Canva', items: 24, updated: '2026-02-01' },
        { id: 2, name: 'Email Signatures', type: 'HTML', items: 8, updated: '2026-01-15' },
        { id: 3, name: 'Letterhead & Documents', type: 'Word/PDF', items: 6, updated: '2026-01-20' },
        { id: 4, name: 'Business Cards', type: 'Print-Ready', items: 3, updated: '2025-12-10' },
        { id: 5, name: 'Vehicle Wraps', type: 'AI/PDF', items: 4, updated: '2025-11-15' },
        { id: 6, name: 'Trade Show Materials', type: 'Print-Ready', items: 12, updated: '2026-01-28' },
        { id: 7, name: 'Proposal Templates', type: 'PowerPoint', items: 3, updated: '2026-02-03' },
        { id: 8, name: 'Photo Library', type: 'JPG/PNG', items: 156, updated: '2026-02-05' },
      ];

      // Landing Page (Not Connected)
      if (!isConnected) {
        return (
          <div className="min-h-[80vh] flex items-center justify-center">
            <div className="max-w-2xl text-center">
              {/* Partner Logo */}
              <div className="mb-8">
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl shadow-lg">
                  <Icon name="palette" className="text-white text-2xl" />
                  <span className="text-2xl font-bold text-white tracking-tight">Refined Marketing Co.</span>
                </div>
              </div>

              {/* Partnership Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium mb-6">
                <Icon name="handshake" />
                Official Marketing Partner
              </div>

              <h1 className="text-4xl font-bold text-gray-900 mb-4">
                We've Partnered with Refined Marketing Co.
              </h1>

              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Refined Marketing Co. is a full-service creative agency specializing in construction and heavy equipment industries. They handle everything from brand identity and website design to social media management and lead generation—so you can focus on what you do best: moving dirt.
              </p>

              {/* Services Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
                {[
                  { icon: 'palette', label: 'Brand Identity' },
                  { icon: 'globe', label: 'Website Design' },
                  { icon: 'hashtag', label: 'Social Media' },
                  { icon: 'magnifying-glass', label: 'SEO Strategy' },
                  { icon: 'camera', label: 'Photography' },
                  { icon: 'bullhorn', label: 'Advertising' },
                ].map((service, i) => (
                  <div key={i} className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Icon name={service.icon} className="text-orange-600" />
                    </div>
                    <span className="font-medium text-gray-700">{service.label}</span>
                  </div>
                ))}
              </div>

              {/* CTA Button */}
              <button
                onClick={() => setIsConnected(true)}
                className="inline-flex items-center gap-3 px-8 py-4 bg-dark-900 hover:bg-dark-800 text-white font-semibold rounded-xl text-lg transition-all transform hover:scale-105 shadow-lg"
              >
                <Icon name="rocket" />
                Get Started
                <Icon name="arrow-right" />
              </button>

              <p className="mt-6 text-sm text-gray-500">
                Already a Refined Marketing client? Click above to access your brand assets.
              </p>
            </div>
          </div>
        );
      }

      // Connected Dashboard
      return (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl">
                <Icon name="palette" className="text-white text-xl" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Refined Marketing Co.</h2>
                <p className="text-sm text-gray-500">Your marketing assets and brand resources</p>
              </div>
            </div>
            <a href="https://refinedmarketingco.com" target="_blank" className="flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium">
              <Icon name="external-link" /> Visit Refined Marketing
            </a>
          </div>

          {/* Current Plan Card */}
          <Card className="p-6 bg-gradient-to-r from-dark-900 to-dark-800 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm mb-1">Your Current Plan</p>
                <h3 className="text-2xl font-bold mb-2">{currentPlan.name}</h3>
                <div className="flex items-center gap-4">
                  <span className="text-3xl font-bold text-brand-400">{currentPlan.price}</span>
                  <Badge className="bg-green-500/20 text-green-400 border border-green-500/30">Active</Badge>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-400 text-sm mb-2">Plan includes:</p>
                <div className="space-y-1">
                  {currentPlan.features.slice(0, 3).map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-gray-300">
                      <Icon name="check" className="text-green-400" />
                      {feature}
                    </div>
                  ))}
                  <p className="text-gray-500 text-sm">+{currentPlan.features.length - 3} more</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-400">Next billing: {formatDate(currentPlan.nextBilling)}</span>
              <Button variant="secondary" size="sm">Manage Plan</Button>
            </div>
          </Card>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="flex gap-6">
              {[
                { id: 'branding', label: 'Branding Kit', icon: 'palette' },
                { id: 'creative', label: 'Creative Assets', icon: 'images' },
                { id: 'video', label: 'Video Production', icon: 'video' },
                { id: 'guidelines', label: 'Brand Guidelines', icon: 'book' },
                { id: 'support', label: 'Support', icon: 'headset' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon name={tab.icon} />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Branding Kit Tab */}
          {activeTab === 'branding' && (
            <div className="space-y-6">
              {/* Logos */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="shapes" className="mr-2 text-brand-500" />
                  Logo Files
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {brandAssets.logos.map(logo => (
                    <div key={logo.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white rounded-lg border border-gray-200 flex items-center justify-center">
                          <Icon name="image" className="text-2xl text-gray-400" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{logo.name}</p>
                          <p className="text-sm text-gray-500">{logo.format} • {logo.size}</p>
                        </div>
                      </div>
                      <Button variant="secondary" size="sm">
                        <Icon name="download" className="mr-1" /> Download
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Colors */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="droplet" className="mr-2 text-brand-500" />
                  Brand Colors
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {brandAssets.colors.map((color, i) => (
                    <div key={i} className="text-center">
                      <div className="w-full h-24 rounded-lg mb-3 shadow-inner" style={{ backgroundColor: color.hex }}></div>
                      <p className="font-medium text-gray-900">{color.name}</p>
                      <p className="text-sm text-gray-500">{color.hex}</p>
                      <p className="text-xs text-gray-400">RGB: {color.rgb}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Fonts */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="font" className="mr-2 text-brand-500" />
                  Typography
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {brandAssets.fonts.map((font, i) => (
                    <div key={i} className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-2xl font-bold text-gray-900 mb-2" style={{ fontFamily: font.name }}>{font.name}</p>
                      <p className="text-sm text-gray-600">Usage: {font.usage}</p>
                      <p className="text-sm text-gray-500">Weights: {font.weights}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Creative Assets Tab */}
          {activeTab === 'creative' && (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {creativeAssets.map(asset => (
                <Card key={asset.id} className="p-4 hover:shadow-lg transition-shadow cursor-pointer">
                  <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center mb-4">
                    <Icon name={
                      asset.type.includes('Canva') ? 'pen-ruler' :
                      asset.type.includes('HTML') ? 'code' :
                      asset.type.includes('Word') ? 'file-word' :
                      asset.type.includes('Print') ? 'print' :
                      asset.type.includes('AI') ? 'bezier-curve' :
                      asset.type.includes('PowerPoint') ? 'file-powerpoint' :
                      'images'
                    } className="text-brand-600 text-xl" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-1">{asset.name}</h4>
                  <p className="text-sm text-gray-500 mb-3">{asset.type} • {asset.items} items</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Updated {formatDate(asset.updated)}</span>
                    <Button variant="secondary" size="sm"><Icon name="folder-open" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Video Production Tab */}
          {activeTab === 'video' && (
            <div className="space-y-6">
              {/* Video Services Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { icon: 'helicopter', label: 'Drone Footage', desc: 'Aerial shots of job sites and completed projects', color: 'blue' },
                  { icon: 'video', label: 'Project Videos', desc: 'Time-lapses, before/after, and progress updates', color: 'brand' },
                  { icon: 'microphone', label: 'Testimonials', desc: 'Professional client testimonial videos', color: 'green' },
                ].map((service, i) => (
                  <Card key={i} className="p-5">
                    <div className={`w-12 h-12 bg-${service.color}-100 rounded-xl flex items-center justify-center mb-3`}>
                      <Icon name={service.icon} className={`text-${service.color}-600 text-xl`} />
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-1">{service.label}</h4>
                    <p className="text-sm text-gray-500">{service.desc}</p>
                  </Card>
                ))}
              </div>

              {/* Video Library */}
              <Card className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900">
                    <Icon name="film" className="mr-2 text-brand-500" />
                    Your Video Library
                  </h3>
                  <Button variant="brand" size="sm">
                    <Icon name="plus" className="mr-1" /> Request New Video
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { id: 1, title: 'Highway 42 Project Time-lapse', type: 'Project Video', duration: '2:34', date: '2026-01-28', status: 'Ready', thumbnail: 'road' },
                    { id: 2, title: 'Aerial Site Survey - Commercial Park', type: 'Drone Footage', duration: '4:12', date: '2026-01-15', status: 'Ready', thumbnail: 'building' },
                    { id: 3, title: 'Smith Residence Testimonial', type: 'Testimonial', duration: '1:45', date: '2026-01-20', status: 'Ready', thumbnail: 'user' },
                    { id: 4, title: 'Equipment Fleet Overview', type: 'Company Video', duration: '3:22', date: '2025-12-10', status: 'Ready', thumbnail: 'truck' },
                    { id: 5, title: 'Downtown Excavation Progress', type: 'Project Video', duration: '0:00', date: '2026-02-05', status: 'In Production', thumbnail: 'hard-hat' },
                    { id: 6, title: 'Safety Training Recap', type: 'Internal', duration: '5:30', date: '2025-11-20', status: 'Ready', thumbnail: 'shield' },
                  ].map(video => (
                    <div key={video.id} className="bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <div className="aspect-video bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center relative">
                        <Icon name={video.thumbnail} className="text-gray-500 text-4xl" />
                        {video.status === 'Ready' && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                            <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center">
                              <Icon name="play" className="text-gray-900 text-xl ml-1" />
                            </div>
                          </div>
                        )}
                        {video.status === 'In Production' && (
                          <div className="absolute top-2 right-2">
                            <Badge className="bg-yellow-500 text-white">In Production</Badge>
                          </div>
                        )}
                        {video.duration !== '0:00' && (
                          <span className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">{video.duration}</span>
                        )}
                      </div>
                      <div className="p-3">
                        <h4 className="font-medium text-gray-900 text-sm mb-1 truncate">{video.title}</h4>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">{video.type}</span>
                          <span className="text-xs text-gray-400">{formatDate(video.date)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Upcoming Shoots */}
              <Card className="p-4">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="calendar-days" className="mr-2 text-brand-500" />
                  Upcoming Video Shoots
                </h3>
                <div className="space-y-3">
                  {[
                    { date: '2026-02-12', title: 'Industrial Park Drone Shoot', location: '4500 Commerce Dr', crew: 'Refined Video Team' },
                    { date: '2026-02-18', title: 'Client Testimonial Recording', location: 'Office / Remote', crew: 'Jordan M.' },
                    { date: '2026-02-25', title: 'Spring Equipment Showcase', location: 'Equipment Yard', crew: 'Refined Video Team' },
                  ].map((shoot, i) => (
                    <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                      {(() => {
                        const utcDate = new Date(`${shoot.date}T00:00:00Z`);
                        return (
                      <div className="text-center min-w-[60px]">
                        <p className="text-xs text-gray-500 uppercase">{utcDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</p>
                        <p className="text-2xl font-bold text-gray-900">{utcDate.getUTCDate()}</p>
                      </div>
                        );
                      })()}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{shoot.title}</p>
                        <p className="text-sm text-gray-500">
                          <Icon name="location-dot" className="mr-1" />{shoot.location}
                          <span className="mx-2">•</span>
                          <Icon name="user" className="mr-1" />{shoot.crew}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm">Details</Button>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Brand Guidelines Tab */}
          {activeTab === 'guidelines' && (
            <Card className="p-8 text-center">
              <div className="w-20 h-20 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Icon name="book-open" className="text-brand-600 text-3xl" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Brand Guidelines Document</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                Your complete brand guidelines including logo usage, color specifications, typography rules, and brand voice.
              </p>
              <Button variant="brand" size="lg">
                <Icon name="download" className="mr-2" /> Download Brand Guidelines (PDF)
              </Button>
            </Card>
          )}

          {/* Support Tab */}
          {activeTab === 'support' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="user-tie" className="mr-2 text-brand-500" />
                  Your Account Manager
                </h3>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 bg-brand-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
                    JM
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Jordan Mitchell</p>
                    <p className="text-sm text-gray-500">Senior Account Manager</p>
                    <p className="text-sm text-brand-600">jordan@refinedmarketingco.com</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1"><Icon name="envelope" className="mr-2" />Email</Button>
                  <Button variant="secondary" className="flex-1"><Icon name="calendar" className="mr-2" />Schedule Call</Button>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold text-gray-900 mb-4">
                  <Icon name="circle-question" className="mr-2 text-brand-500" />
                  Need Help?
                </h3>
                <div className="space-y-3">
                  <a href="#" className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <Icon name="message" className="text-brand-500" />
                    <span className="text-sm font-medium text-gray-700">Request a Design Update</span>
                    <Icon name="arrow-right" className="ml-auto text-gray-400" />
                  </a>
                  <a href="#" className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <Icon name="lightbulb" className="text-brand-500" />
                    <span className="text-sm font-medium text-gray-700">Submit a Creative Request</span>
                    <Icon name="arrow-right" className="ml-auto text-gray-400" />
                  </a>
                  <a href="#" className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <Icon name="chart-line" className="text-brand-500" />
                    <span className="text-sm font-medium text-gray-700">View Monthly Report</span>
                    <Icon name="arrow-right" className="ml-auto text-gray-400" />
                  </a>
                </div>
              </Card>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // MODALS
    // ============================================

    const QuickActionsModal = ({ isOpen, onClose, setShowModal }) => (
      <Modal isOpen={isOpen} onClose={onClose} title="Quick Actions" size="sm">
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: 'calendar-plus', label: 'Add Event', action: 'calendar-event', color: 'indigo' },
            { icon: 'clock', label: 'Time Clock', action: 'time-clock', color: 'blue' },
            { icon: 'clipboard-check', label: 'Equipment Check-In', action: 'equipment-checkin', color: 'green' },
            { icon: 'file-lines', label: 'Daily Report', action: 'daily-report', color: 'brand' },
            { icon: 'wrench', label: 'Work Order', action: 'work-order', color: 'yellow' },
            { icon: 'shield-halved', label: 'Safety Sign-Off', action: 'safety', color: 'red' },
            { icon: 'camera', label: 'Photo Upload', action: 'photo', color: 'purple' },
          ].map(item => (
            <button
              key={item.action}
              onClick={() => { onClose(); setShowModal({ type: item.action }); }}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <div className={`p-3 rounded-full bg-${item.color}-100`}>
                <Icon name={item.icon} className={`text-${item.color}-600 text-lg`} />
              </div>
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </button>
          ))}
        </div>
      </Modal>
    );

    const CalendarEventModal = ({ isOpen, onClose, employees, currentRole, initialData, onCreated }) => {
      const parseLocalDateTime = (value) => {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
        if (!match) return null;
        const [, year, month, day, hour, minute] = match;
        const date = new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          0,
          0
        );
        return Number.isNaN(date.getTime()) ? null : date;
      };

      const toLocalInputValue = (date) => {
        const dt = new Date(date);
        const year = dt.getFullYear();
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        const hour = String(dt.getHours()).padStart(2, '0');
        const minute = String(dt.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hour}:${minute}`;
      };

      const [title, setTitle] = useState('');
      const [eventType, setEventType] = useState('meeting');
      const [visibility, setVisibility] = useState('attendees');
      const [startsAt, setStartsAt] = useState(toLocalInputValue(new Date()));
      const [endsAt, setEndsAt] = useState(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
      const [locationText, setLocationText] = useState('');
      const [description, setDescription] = useState('');
      const [attendeeEmployeeIds, setAttendeeEmployeeIds] = useState([]);
      const [attendeeSearch, setAttendeeSearch] = useState('');
      const [favoriteEmployeeIds, setFavoriteEmployeeIds] = useState([]);
      const [externalAttendees, setExternalAttendees] = useState([]);
      const [externalName, setExternalName] = useState('');
      const [externalContact, setExternalContact] = useState('');
      const [saving, setSaving] = useState(false);
      const [deleting, setDeleting] = useState(false);
      const [error, setError] = useState('');
      const [warning, setWarning] = useState('');
      const isEditMode = Boolean(initialData?.id);
      const canEditExisting = ['executive', 'operations', 'admin', 'pm'].includes(String(currentRole || '').toLowerCase());
      const isReadOnly = isEditMode && !canEditExisting;

      useEffect(() => {
        if (!isOpen || typeof window === 'undefined') return;
        try {
          const raw = window.localStorage.getItem('calendar.favoriteEmployeeIds');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) {
            setFavoriteEmployeeIds(parsed.map((id) => String(id)));
          }
        } catch {
          setFavoriteEmployeeIds([]);
        }
      }, [isOpen]);

      useEffect(() => {
        if (!isOpen) return;
        if (initialData?.title !== undefined) setTitle(String(initialData.title || ''));
        if (initialData?.eventType !== undefined) setEventType(String(initialData.eventType || 'meeting'));
        if (initialData?.visibility !== undefined) setVisibility(String(initialData.visibility || 'attendees'));
        if (initialData?.locationText !== undefined) setLocationText(String(initialData.locationText || ''));
        if (initialData?.description !== undefined) setDescription(String(initialData.description || ''));
        if (!initialData?.startsAt) return;
        const start = new Date(initialData.startsAt);
        if (Number.isNaN(start.getTime())) return;
        const end = initialData?.endsAt ? new Date(initialData.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
        setStartsAt(toLocalInputValue(start));
        setEndsAt(toLocalInputValue(Number.isNaN(end.getTime()) ? new Date(start.getTime() + 60 * 60 * 1000) : end));
      }, [isOpen, initialData]);

      const reset = () => {
        setTitle('');
        setEventType('meeting');
        setVisibility('attendees');
        setStartsAt(toLocalInputValue(new Date()));
        setEndsAt(toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
        setLocationText('');
        setDescription('');
        setAttendeeEmployeeIds([]);
        setAttendeeSearch('');
        setExternalAttendees([]);
        setExternalName('');
        setExternalContact('');
        setError('');
        setWarning('');
      };

      const persistFavorites = (next) => {
        setFavoriteEmployeeIds(next);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('calendar.favoriteEmployeeIds', JSON.stringify(next));
        }
      };

      const toggleFavoriteEmployee = (employeeId) => {
        const id = String(employeeId);
        if (favoriteEmployeeIds.includes(id)) {
          persistFavorites(favoriteEmployeeIds.filter((item) => item !== id));
        } else {
          persistFavorites([id, ...favoriteEmployeeIds]);
        }
      };

      const toggleAttendeeEmployee = (employeeId) => {
        const id = String(employeeId);
        setAttendeeEmployeeIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
      };

      const addExternalAttendee = () => {
        const trimmedName = externalName.trim();
        const trimmedContact = externalContact.trim();
        if (!trimmedName) return;
        setExternalAttendees((prev) => [...prev, { name: trimmedName, contact: trimmedContact }]);
        setExternalName('');
        setExternalContact('');
      };

      const removeExternalAttendee = (index) => {
        setExternalAttendees((prev) => prev.filter((_, idx) => idx !== index));
      };

      const filteredEmployees = employees.filter((employee) => {
        const haystack = `${employee.name || ''} ${employee.role || ''}`.toLowerCase();
        return haystack.includes(attendeeSearch.trim().toLowerCase());
      });

      const selectedEmployees = attendeeEmployeeIds
        .map((id) => employees.find((employee) => String(employee.id) === String(id)))
        .filter(Boolean);

      const favoriteEmployees = favoriteEmployeeIds
        .map((id) => employees.find((employee) => String(employee.id) === String(id)))
        .filter(Boolean);

      const handleSubmit = async () => {
        if (!title.trim()) return;
        try {
          setSaving(true);
          setError('');
          const parsedStart = parseLocalDateTime(startsAt);
          const parsedEnd = parseLocalDateTime(endsAt);
          if (!parsedStart || !parsedEnd) {
            setError('Invalid start or end time');
            return;
          }
          if (parsedEnd.getTime() <= parsedStart.getTime()) {
            setError('End time must be after start time');
            return;
          }
          const attendees = [
            ...attendeeEmployeeIds.map((employeeId) => ({
              attendeeType: 'employee',
              employeeId: String(employeeId),
            })),
            ...externalAttendees.map((attendee) => ({
              attendeeType: 'external',
              externalName: attendee.name,
              externalContact: attendee.contact || undefined,
            })),
          ];
          const eventUrl = isEditMode ? `/api/calendar/events/${initialData.id}` : '/api/calendar/events';
          const response = await fetch(eventUrl, {
            method: isEditMode ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: title.trim(),
              eventType,
              visibility,
              startsAt: parsedStart.toISOString(),
              endsAt: parsedEnd.toISOString(),
              locationText,
              description,
              ...(isEditMode ? {} : { attendees }),
            }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(payload?.error || 'Failed to create event');
            return;
          }
          if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
            setWarning(payload.warnings.join(' '));
            return;
          }
          reset();
          if (typeof onCreated === 'function') onCreated();
          onClose();
        } catch {
          setError(isEditMode ? 'Failed to update event' : 'Failed to create event');
        } finally {
          setSaving(false);
        }
      };

      const handleDelete = async () => {
        if (!isEditMode || isReadOnly || !initialData?.id) return;
        if (typeof window !== 'undefined') {
          const confirmed = window.confirm('Delete this event? This cannot be undone.');
          if (!confirmed) return;
        }

        try {
          setDeleting(true);
          setError('');
          const response = await fetch(`/api/calendar/events/${initialData.id}`, { method: 'DELETE' });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(payload?.error || 'Failed to delete event');
            return;
          }
          reset();
          if (typeof onCreated === 'function') onCreated();
          onClose();
        } catch {
          setError('Failed to delete event');
        } finally {
          setDeleting(false);
        }
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEditMode ? (isReadOnly ? 'Event Details' : 'Edit Event') : 'Add Event'} size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={isReadOnly} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100" placeholder="Weekly planning meeting" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starts</label>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => {
                    if (isReadOnly) return;
                    const nextStart = e.target.value;
                    setStartsAt(nextStart);
                    const startDate = new Date(nextStart);
                    if (!Number.isNaN(startDate.getTime())) {
                      const nextEndDate = new Date(startDate.getTime() + 60 * 60 * 1000);
                      setEndsAt(toLocalInputValue(nextEndDate));
                    }
                  }}
                  disabled={isReadOnly}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ends</label>
                <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={isReadOnly} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={eventType} onChange={(e) => setEventType(e.target.value)} disabled={isReadOnly} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100">
                  <option value="meeting">Meeting</option>
                  <option value="client">Client</option>
                  <option value="inspection">Inspection</option>
                  <option value="delivery">Delivery</option>
                  <option value="internal">Internal</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value)} disabled={isReadOnly} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100">
                  <option value="attendees">Attendees</option>
                  <option value="company">Company</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>
            {!isEditMode && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Attendees</label>
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:text-brand-700"
                  onClick={() => {
                    setVisibility('private');
                    setAttendeeEmployeeIds([]);
                    setExternalAttendees([]);
                  }}
                >
                  Meeting with just me
                </button>
              </div>

              {favoriteEmployees.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-gray-500 mb-1">Favorites</p>
                  <div className="flex flex-wrap gap-1">
                    {favoriteEmployees.map((employee) => {
                      const selected = attendeeEmployeeIds.includes(String(employee.id));
                      return (
                        <button
                          key={`fav-employee-${employee.id}`}
                          type="button"
                          onClick={() => toggleAttendeeEmployee(employee.id)}
                          className={`px-2 py-1 text-xs rounded border ${
                            selected ? 'bg-brand-100 border-brand-300 text-brand-700' : 'bg-white border-gray-300 text-gray-700'
                          }`}
                        >
                          {employee.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <input
                value={attendeeSearch}
                onChange={(e) => setAttendeeSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Search employees..."
              />

              <div className="mt-2 max-h-36 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {filteredEmployees.map((employee) => {
                  const selected = attendeeEmployeeIds.includes(String(employee.id));
                  const favorite = favoriteEmployeeIds.includes(String(employee.id));
                  return (
                    <div key={`attendee-row-${employee.id}`} className="flex items-center justify-between px-3 py-2 text-sm">
                      <button
                        type="button"
                        className={`text-left flex-1 ${selected ? 'text-brand-700 font-medium' : 'text-gray-700'}`}
                        onClick={() => toggleAttendeeEmployee(employee.id)}
                      >
                        {employee.name} <span className="text-xs text-gray-400">{employee.role}</span>
                      </button>
                      <button
                        type="button"
                        className={`ml-2 text-xs ${favorite ? 'text-brand-600' : 'text-gray-400 hover:text-gray-600'}`}
                        onClick={() => toggleFavoriteEmployee(employee.id)}
                      >
                        {favorite ? 'Favorited' : 'Favorite'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedEmployees.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedEmployees.map((employee) => (
                    <span key={`selected-employee-${employee.id}`} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-brand-50 text-brand-700 border border-brand-200">
                      {employee.name}
                      <button type="button" onClick={() => toggleAttendeeEmployee(employee.id)}>
                        <Icon name="xmark" className="text-[10px]" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">External attendees (placeholder)</label>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Name (homeowner/client)"
                />
                <input
                  value={externalContact}
                  onChange={(e) => setExternalContact(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Phone or email (optional)"
                />
                <Button type="button" variant="secondary" onClick={addExternalAttendee} disabled={!externalName.trim()}>
                  Add
                </Button>
              </div>
              {externalAttendees.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {externalAttendees.map((attendee, index) => (
                    <span key={`external-attendee-${index}`} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-50 text-gray-700 border border-gray-200">
                      {attendee.name}
                      {attendee.contact ? ` (${attendee.contact})` : ''}
                      <button type="button" onClick={() => removeExternalAttendee(index)}>
                        <Icon name="xmark" className="text-[10px]" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={isReadOnly} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100" placeholder="Main office" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={isReadOnly} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 disabled:bg-gray-100" />
            </div>
            {warning && <p className="text-sm text-yellow-700">{warning}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3">
              {!isReadOnly && isEditMode && (
                <Button variant="danger" onClick={handleDelete} disabled={saving || deleting}>
                  {deleting ? 'Deleting...' : 'Delete Event'}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} disabled={saving || deleting}>{isReadOnly ? 'Close' : 'Cancel'}</Button>
              {!isReadOnly && (
                <Button variant="brand" onClick={handleSubmit} disabled={saving || deleting || !title.trim()}>{saving ? 'Saving...' : (isEditMode ? 'Save Changes' : 'Create Event')}</Button>
              )}
            </div>
          </div>
        </Modal>
      );
    };

    const TimeClockModal = ({ isOpen, onClose, employees, jobs, setTimeEntries }) => {
      const [selectedEmployee, setSelectedEmployee] = useState('');
      const [selectedJob, setSelectedJob] = useState('');
      const [action, setAction] = useState('in');
      const [notes, setNotes] = useState('');

      const handleSubmit = () => {
        if (!selectedEmployee || !selectedJob) return;
        setTimeEntries(prev => [...prev, {
          id: Date.now(),
          employeeId: Number(selectedEmployee),
          jobId: Number(selectedJob),
          action,
          time: new Date().toISOString(),
          notes,
        }]);
        onClose();
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title="Time Clock" size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
              <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select Employee</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} - {emp.role}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Site</label>
              <select value={selectedJob} onChange={(e) => setSelectedJob(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select Job</option>
                {jobs.filter(j => j.status === 'active').map(job => <option key={job.id} value={job.id}>{job.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Action</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="action" value="in" checked={action === 'in'} onChange={(e) => setAction(e.target.value)} className="text-brand-500" />
                  <span>Clock In</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="action" value="out" checked={action === 'out'} onChange={(e) => setAction(e.target.value)} className="text-brand-500" />
                  <span>Clock Out</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Optional notes..." />
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-sm">
              <p><strong>Time:</strong> {formatTime(new Date())}</p>
              <p><strong>Location:</strong> GPS coordinates will be captured</p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="brand" onClick={handleSubmit}>Submit</Button>
            </div>
          </div>
        </Modal>
      );
    };

    const EquipmentCheckInModal = ({ isOpen, onClose, equipment, setEquipment, employees, jobs }) => {
      const [form, setForm] = useState({ equipmentId: '', jobId: '', hoursWorked: '', meterReading: '', fuelLevel: '', condition: 'good', operator: '', notes: '' });

      const handleSubmit = () => {
        if (!form.equipmentId) return;
        setEquipment(prev => prev.map(eq =>
          eq.id === Number(form.equipmentId)
            ? { ...eq, hours: Number(form.meterReading) || eq.hours, fuelLevel: Number(form.fuelLevel) || eq.fuelLevel, jobId: Number(form.jobId) || eq.jobId }
            : eq
        ));
        onClose();
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title="Equipment Check-In" size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Equipment</label>
              <select value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select Equipment</option>
                {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job Site</label>
                <select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Select Job</option>
                  {jobs.filter(j => j.status === 'active').map(job => <option key={job.id} value={job.id}>{job.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Operator</label>
                <select value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Select Operator</option>
                  {employees.filter(e => e.role === 'Equipment Operator').map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hours Worked</label>
                <input type="number" value={form.hoursWorked} onChange={(e) => setForm({ ...form, hoursWorked: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="8" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Meter Reading</label>
                <input type="number" value={form.meterReading} onChange={(e) => setForm({ ...form, meterReading: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="4521" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fuel Level %</label>
                <input type="number" value={form.fuelLevel} onChange={(e) => setForm({ ...form, fuelLevel: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="75" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Condition</label>
              <div className="flex gap-4">
                {['good', 'fair', 'needs_attention'].map(c => (
                  <label key={c} className="flex items-center gap-2">
                    <input type="radio" name="condition" value={c} checked={form.condition === c} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
                    <span className="capitalize">{c.replace('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Issues</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Any issues or notes..." />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="brand" onClick={handleSubmit}>Submit Check-In</Button>
            </div>
          </div>
        </Modal>
      );
    };

    const DailyReportModal = ({ isOpen, onClose, jobs, employees, dailyReports, setDailyReports }) => {
      const [form, setForm] = useState({ jobId: '', weather: '', tempHigh: '', tempLow: '', crewSize: '', workAccomplished: '', issues: '', tomorrowPlan: '' });
      const [materials, setMaterials] = useState([{ item: '', qty: '', unit: 'CY' }]);
      const [submitLoading, setSubmitLoading] = useState(false);
      const [submitError, setSubmitError] = useState('');

      const handleSubmit = async () => {
        setSubmitError('');

        setSubmitLoading(true);
        try {
          const response = await fetch('/api/daily-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId: form.jobId ? Number(form.jobId) || form.jobId : null,
              date: new Date().toISOString().split('T')[0],
              weather: form.weather,
              tempHigh: Number(form.tempHigh) || 0,
              tempLow: Number(form.tempLow) || 0,
              crewSize: Number(form.crewSize) || 0,
              workAccomplished: form.workAccomplished,
              materialsUsed: materials.filter(m => m.item),
              issues: form.issues,
              tomorrowPlan: form.tomorrowPlan,
              notes: form.workAccomplished,
            }),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.dailyReport) {
            setSubmitError(payload?.error || raw || 'Failed to create daily report');
            setSubmitLoading(false);
            return;
          }

          setDailyReports(prev => [payload.dailyReport, ...prev]);
          onClose();
        } catch {
          setSubmitError('Failed to create daily report');
        } finally {
          setSubmitLoading(false);
        }
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title="Daily Report" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job Site</label>
                <select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Unassigned</option>
                  {jobs.filter(j => j.status === 'active').map(job => <option key={job.id} value={job.id}>{job.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Crew Size</label>
                <input type="number" value={form.crewSize} onChange={(e) => setForm({ ...form, crewSize: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weather</label>
                <select value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Select</option>
                  {['Sunny', 'Partly Cloudy', 'Cloudy', 'Rain', 'Snow'].map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">High Temp °F</label>
                <input type="number" value={form.tempHigh} onChange={(e) => setForm({ ...form, tempHigh: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Low Temp °F</label>
                <input type="number" value={form.tempLow} onChange={(e) => setForm({ ...form, tempLow: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Accomplished</label>
              <textarea value={form.workAccomplished} onChange={(e) => setForm({ ...form, workAccomplished: e.target.value })} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Describe work completed today..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Materials Used</label>
              {materials.map((m, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input type="text" value={m.item} onChange={(e) => setMaterials(prev => prev.map((p, j) => j === i ? { ...p, item: e.target.value } : p))} placeholder="Material" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input type="number" value={m.qty} onChange={(e) => setMaterials(prev => prev.map((p, j) => j === i ? { ...p, qty: e.target.value } : p))} placeholder="Qty" className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <select value={m.unit} onChange={(e) => setMaterials(prev => prev.map((p, j) => j === i ? { ...p, unit: e.target.value } : p))} className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm">
                    {['CY', 'TN', 'LF', 'EA', 'GAL', 'SF'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setMaterials(prev => [...prev, { item: '', qty: '', unit: 'CY' }])}>
                <Icon name="plus" className="mr-1" /> Add Material
              </Button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issues / Delays</label>
              <textarea value={form.issues} onChange={(e) => setForm({ ...form, issues: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Any issues or delays encountered..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tomorrow's Plan</label>
              <textarea value={form.tomorrowPlan} onChange={(e) => setForm({ ...form, tomorrowPlan: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Planned work for tomorrow..." />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="brand" onClick={handleSubmit} disabled={submitLoading}>
                {submitLoading ? 'Submitting...' : 'Submit Report'}
              </Button>
            </div>
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          </div>
        </Modal>
      );
    };

    const WorkOrderModal = ({ isOpen, onClose, equipment, employees, workOrders, setWorkOrders, data }) => {
      const [form, setForm] = useState({
        equipmentId: data?.equipmentId || '',
        type: data?.type || 'repair',
        priority: 'medium',
        title: '',
        description: '',
        assignedTo: '',
        dueDate: '',
      });
      const [submitLoading, setSubmitLoading] = useState(false);
      const [submitError, setSubmitError] = useState('');

      const handleSubmit = async () => {
        setSubmitError('');
        if (!form.equipmentId || !form.title) {
          setSubmitError('Equipment and title are required');
          return;
        }

        setSubmitLoading(true);
        try {
          const response = await fetch('/api/work-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              equipmentId: form.equipmentId,
              type: form.type,
              priority: form.priority,
              status: 'scheduled',
              title: form.title,
              description: form.description,
              assignedTo: form.assignedTo || null,
              dueDate: form.dueDate,
              laborHours: 0,
            }),
          });

          const raw = await response.text();
          let payload = null;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch {
            payload = null;
          }

          if (!response.ok || !payload?.workOrder) {
            setSubmitError(payload?.error || raw || 'Failed to create work order');
            setSubmitLoading(false);
            return;
          }

          setWorkOrders((prev) => [payload.workOrder, ...prev]);
          onClose();
        } catch {
          setSubmitError('Failed to create work order');
        } finally {
          setSubmitLoading(false);
        }
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Work Order" size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Equipment</label>
              <select value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select Equipment</option>
                {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="repair">Repair</option>
                  <option value="preventive">Preventive Maintenance</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Brief description of the issue..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Detailed description..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
                <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                  <option value="">Select Technician</option>
                  {employees.filter(e => e.role === 'Mechanic').map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="brand" onClick={handleSubmit} disabled={submitLoading}>
                {submitLoading ? 'Creating...' : 'Create Work Order'}
              </Button>
            </div>
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          </div>
        </Modal>
      );
    };

    const SafetyModal = ({ isOpen, onClose, employees, jobs, onSubmitSafetyLog, submitLoading }) => {
      const [form, setForm] = useState({ type: 'toolbox', topic: '', jobId: '', notes: '' });
      const [attendees, setAttendees] = useState([]);
      const [submitError, setSubmitError] = useState('');

      const topics = {
        toolbox: ['Excavation Safety', 'Fall Protection', 'Heat Illness Prevention', 'Electrical Safety', 'PPE Requirements', 'Housekeeping'],
        preop: ['Excavator Inspection', 'Dozer Inspection', 'Loader Inspection', 'Truck Inspection'],
        jsa: ['Trench Work', 'Overhead Utilities', 'Confined Space', 'Heavy Lifting', 'Working Near Traffic'],
      };

      const severityByType = {
        toolbox: 'low',
        preop: 'medium',
        jsa: 'high',
      };

      useEffect(() => {
        if (!isOpen) return;
        setForm({ type: 'toolbox', topic: '', jobId: '', notes: '' });
        setAttendees([]);
        setSubmitError('');
      }, [isOpen]);

      const handleSubmit = async () => {
        setSubmitError('');
        if (!form.topic) {
          setSubmitError('Topic is required');
          return;
        }
        const extra = form.notes?.trim();
        const summary = extra ? `${form.topic} — ${extra}` : form.topic;
        const payload = {
          occurred_on: new Date().toISOString().slice(0, 10),
          summary,
          severity: severityByType[form.type] || 'medium',
        };
        const result = await onSubmitSafetyLog(payload);
        if (!result?.ok) {
          setSubmitError(result?.error || 'Failed to create safety log');
          return;
        }
        onClose();
      };

      return (
        <Modal isOpen={isOpen} onClose={onClose} title="Safety Sign-Off" size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
              <div className="flex gap-4">
                {[{ id: 'toolbox', label: 'Toolbox Talk' }, { id: 'preop', label: 'Pre-Op Inspection' }, { id: 'jsa', label: 'JSA' }].map(t => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input type="radio" name="type" value={t.id} checked={form.type === t.id} onChange={(e) => setForm({ ...form, type: e.target.value, topic: '' })} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
              <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2" data-testid="safety-topic">
                <option value="">Select Topic</option>
                {topics[form.type]?.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Job Site</label>
              <select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2">
                <option value="">Select Job</option>
                {jobs.filter(j => j.status === 'active').map(job => <option key={job.id} value={job.id}>{job.name}</option>)}
              </select>
            </div>
            {form.type !== 'preop' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Attendees</label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-gray-200 rounded-lg">
                  {employees.filter(e => e.status === 'clocked-in').map(emp => (
                    <label key={emp.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={attendees.includes(emp.id)} onChange={(e) => {
                        if (e.target.checked) setAttendees(prev => [...prev, emp.id]);
                        else setAttendees(prev => prev.filter(id => id !== emp.id));
                      }} />
                      {emp.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="Additional notes..." data-testid="safety-notes" />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose} disabled={submitLoading}>Cancel</Button>
              <Button variant="brand" onClick={handleSubmit} disabled={submitLoading} data-testid="safety-submit">
                {submitLoading ? 'Saving...' : 'Submit Sign-Off'}
              </Button>
            </div>
            {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          </div>
        </Modal>
      );
    };

    // ============================================
    // LANDING PAGE
    // ============================================
    const LandingPage = ({ onLogin, onSignup }) => {
      const [showAuthModal, setShowAuthModal] = useState(false);
      const [authMode, setAuthMode] = useState('login');
      const [formData, setFormData] = useState({ name: '', email: '', password: '', company: '' });
      const [authError, setAuthError] = useState('');
      const [authNotice, setAuthNotice] = useState('');
      const [authLoading, setAuthLoading] = useState(false);

      // =====================================================
      // IMAGE CONFIGURATION - UPDATE THESE WITH YOUR PHOTOS
      // =====================================================
      // Upload your photos to GitHub, Imgur, or your server
      // Then replace these placeholder URLs with your actual URLs
      const IMAGES = {
        // Hero background - Volvo excavator on dirt mound
        hero: 'YOUR_HERO_IMAGE_URL',
        // CTA section background
        ctaBg: 'YOUR_CTA_BG_URL',
        // Gallery images (8 total)
        gallery: [
          'YOUR_GALLERY_IMAGE_1_URL', // Large - Volvo EC220D on mound
          'YOUR_GALLERY_IMAGE_2_URL', // Aerial trenching shot
          'YOUR_GALLERY_IMAGE_3_URL', // CAT D6M dozer
          'YOUR_GALLERY_IMAGE_4_URL', // Operator in cab
          'YOUR_GALLERY_IMAGE_5_URL', // Wheel loader
          'YOUR_GALLERY_IMAGE_6_URL', // Large - Excavator
          'YOUR_GALLERY_IMAGE_7_URL', // Dozer on pile
          'YOUR_GALLERY_IMAGE_8_URL', // Dozer in woods
        ],
      };

      const features = [
        { icon: 'grid-2', title: 'Unified Dashboard', desc: 'Real-time overview of all operations, jobs, and equipment in one place.' },
        { icon: 'truck-field', title: 'Fleet Management', desc: 'Track equipment location, hours, maintenance schedules, and utilization.' },
        { icon: 'calendar-week', title: 'Smart Scheduling', desc: 'Drag-and-drop crew and equipment scheduling with conflict detection.' },
        { icon: 'comments', title: 'Team Messaging', desc: 'Built-in communication with channels, DMs, and file sharing.' },
        { icon: 'money-check-dollar', title: 'Job Costing', desc: 'Track costs, budgets, and profitability for every project in real-time.' },
        { icon: 'shield-heart', title: 'Safety & Compliance', desc: 'Digital safety sign-offs, incident tracking, and certification management.' },
        { icon: 'chart-mixed', title: 'Advanced Reports', desc: 'Generate insights on productivity, costs, and equipment performance.' },
        { icon: 'plug', title: '40+ Integrations', desc: 'Connect QuickBooks, Samsara, Procore, and all your favorite tools.' },
      ];

      const testimonials = [
        { name: 'Marcus Johnson', role: 'Owner, Johnson Excavating', quote: 'Groundwork Pro cut our admin time in half. The scheduling alone saves us 10 hours a week.', avatar: 'MJ' },
        { name: 'Sarah Williams', role: 'Operations Manager, Williams Grading', quote: 'Finally, software built for excavation. The equipment tracking and job costing features are game-changers.', avatar: 'SW' },
        { name: 'Robert Chen', role: 'CEO, Pacific Earthworks', quote: 'We went from spreadsheets to Groundwork Pro and never looked back. ROI in the first month.', avatar: 'RC' },
      ];

      const plans = [
        { name: 'Starter', price: 49, period: '/user/mo', desc: 'For small crews getting started', features: ['All core features', 'Basic scheduling', 'Equipment tracking', 'Mobile app access', 'Email support'], cta: 'Start Free Trial' },
        { name: 'Professional', price: 79, period: '/user/mo', desc: 'For growing excavation companies', features: ['Everything in Starter', 'Advanced scheduling', 'Job costing & budgets', 'Team messaging', 'Integrations', 'Priority support'], cta: 'Start Free Trial', popular: true },
        { name: 'Enterprise', price: 'Custom', period: '', desc: 'For large operations', features: ['Everything in Pro', 'Custom integrations', 'Dedicated account manager', 'On-site training', 'SLA guarantee', 'API access'], cta: 'Contact Sales' },
      ];

      const handleSubmit = async (e) => {
        e.preventDefault();
        setAuthError('');
        setAuthNotice('');
        setAuthLoading(true);
        const supabase = supabaseBrowser();
        const inviteParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const isInviteFlow = inviteParams?.get('invite') === '1';
        const inviteRole = inviteParams?.get('role') || undefined;

        const acceptInviteIfNeeded = async () => {
          if (!isInviteFlow) return;
          const response = await fetch('/api/invite/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: inviteRole }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload?.error || 'Failed to accept invite');
          }
        };

        try {
          if (authMode === 'login') {
            const { error } = await supabase.auth.signInWithPassword({
              email: formData.email,
              password: formData.password,
            });
            if (error) {
              setAuthError(error.message);
              return;
            }

            await supabase.auth.getSession();
            await acceptInviteIfNeeded();
            onLogin(formData);
            return;
          }

          const { data, error } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
          });

          if (error) {
            const normalized = error.message.toLowerCase();
            if (normalized.includes('already') || normalized.includes('exists') || normalized.includes('registered')) {
              setAuthError('This email is already registered. Please log in.');
              return;
            }
            setAuthError(error.message);
            return;
          }

          const identityCount = Array.isArray(data?.user?.identities) ? data.user.identities.length : 1;
          if (data?.user && identityCount === 0) {
            setAuthError('This email is already registered. Please log in.');
            return;
          }

          if (data?.session) {
            await supabase.auth.getSession();
            await acceptInviteIfNeeded();
            onSignup(formData);
            return;
          }

          setAuthNotice('Check your email to confirm your account, then log in.');
        } finally {
          setAuthLoading(false);
        }
      };

      return (
        <div className="min-h-screen bg-white">
          {/* Navigation */}
          <nav className="fixed top-0 left-0 right-0 bg-white/90 backdrop-blur-md z-50 border-b border-gray-100">
            <div className="max-w-7xl mx-auto px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
                    <Icon name="mountain" className="text-white text-lg" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-dozer text-2xl text-gray-900 tracking-wide">GROUNDWORK</span>
                    <span className="text-brand-500 font-dozer text-2xl tracking-wide">PRO</span>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-8">
                  <a href="/features" className="text-gray-600 hover:text-gray-900 font-medium">Features</a>
                  <a href="/pricing" className="text-gray-600 hover:text-gray-900 font-medium">Pricing</a>
                  <a href="/testimonials" className="text-gray-600 hover:text-gray-900 font-medium">Testimonials</a>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <button
                    onClick={() => { window.location.href = '/login'; }}
                    className="px-2 sm:px-4 py-2 text-gray-700 font-medium hover:text-gray-900 whitespace-nowrap"
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => { window.location.href = '/signup'; }}
                    className="hidden sm:inline-flex px-5 py-2.5 bg-brand-500 text-white font-medium rounded-lg hover:bg-brand-600 transition-colors whitespace-nowrap"
                  >
                    Start Free Trial
                  </button>
                </div>
              </div>
            </div>
          </nav>

          {/* Hero Section */}
          <section className="pt-32 pb-20 px-6 relative overflow-hidden">
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
              {IMAGES.hero !== 'YOUR_HERO_IMAGE_URL' ? (
                <img src={IMAGES.hero} alt="Excavator at work" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center">
                  <div className="text-center text-brand-400">
                    <Icon name="image" className="text-6xl mb-2" />
                    <p className="text-sm font-medium">Hero Image - Update IMAGES.hero</p>
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/80"></div>
            </div>

            <div className="max-w-7xl mx-auto relative z-10">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-brand-50 text-brand-700 rounded-full text-sm font-medium mb-6">
                  <Icon name="sparkles" />
                  The #1 Platform for Excavation Companies
                </div>
                <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                  Run Your Excavation Business
                  <span className="text-brand-500"> Like a Pro</span>
                </h1>
                <p className="text-xl text-gray-600 mb-10 leading-relaxed">
                  Manage crews, track equipment, schedule jobs, and control costs—all from one powerful platform built specifically for excavation and grading contractors.
                </p>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <button
                    onClick={() => { window.location.href = '/signup'; }}
                    className="px-8 py-4 bg-brand-500 text-white font-semibold rounded-xl hover:bg-brand-600 transition-all transform hover:scale-105 shadow-lg shadow-brand-500/30 flex items-center gap-2"
                  >
                    Start Free Trial
                    <Icon name="arrow-right" />
                  </button>
                  <button className="px-8 py-4 bg-white text-gray-700 font-semibold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors flex items-center gap-2 shadow-sm">
                    <Icon name="play-circle" />
                    Watch Demo
                  </button>
                </div>
                <p className="mt-6 text-sm text-gray-500">14-day free trial. No credit card required.</p>

                {/* Trust badges */}
                <div className="flex items-center gap-6 mt-10 pt-10 border-t border-gray-200">
                  <div className="flex items-center gap-2">
                    <Icon name="shield-check" className="text-green-500" />
                    <span className="text-sm text-gray-600">SOC 2 Compliant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon name="lock" className="text-green-500" />
                    <span className="text-sm text-gray-600">256-bit Encryption</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon name="clock" className="text-green-500" />
                    <span className="text-sm text-gray-600">99.9% Uptime</span>
                  </div>
                </div>
              </div>

              {/* Dashboard Preview - Working Mini Dashboard */}
              <div className="mt-16 relative">
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent z-10 pointer-events-none" style={{height: '120%'}}></div>
                <div className="bg-dark-900 rounded-2xl p-2 shadow-2xl">
                  <div className="bg-gray-50 rounded-xl overflow-hidden">
                    {/* Browser Chrome */}
                    <div className="bg-dark-800 px-4 py-2 flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      </div>
                      <div className="flex-1 text-center">
                        <span className="text-xs text-gray-400">app.groundworkpro.com/dashboard</span>
                      </div>
                    </div>
                    {/* Mini Dashboard */}
                    <div className="flex h-[500px]">
                      {/* Sidebar */}
                      <div className="w-48 bg-dark-900 p-3 flex-shrink-0">
                        <div className="flex items-center gap-2 mb-6">
                          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
                            <Icon name="mountain" className="text-white text-sm" />
                          </div>
                          <span className="text-white font-dozer text-sm tracking-wide">GROUNDWORK</span>
                        </div>
                        {['Dashboard', 'Messages', 'Schedule', 'Jobs', 'Fleet', 'Team'].map((item, i) => (
                          <div key={i} className={`flex items-center gap-2 px-2 py-2 rounded text-xs mb-1 ${i === 0 ? 'bg-brand-500 text-white' : 'text-gray-400'}`}>
                            <Icon name={['grid-2', 'comments', 'calendar-week', 'briefcase', 'truck-field', 'people-group'][i]} />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                      {/* Main Content */}
                      <div className="flex-1 p-4 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-semibold text-gray-900 text-sm">Dashboard</h3>
                            <p className="text-xs text-gray-500">Friday, February 6, 2026</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-gray-100 rounded flex items-center justify-center">
                              <Icon name="bell" className="text-gray-400 text-xs" />
                            </div>
                            <div className="w-6 h-6 bg-brand-500 rounded-full"></div>
                          </div>
                        </div>
                        {/* Stats */}
                        <div className="grid grid-cols-4 gap-3 mb-4">
                          {[
                            { label: 'Active Jobs', value: '8', icon: 'briefcase', color: 'brand' },
                            { label: 'Fleet Utilization', value: '87%', icon: 'truck-field', color: 'green' },
                            { label: 'Crew On-Site', value: '24', icon: 'users', color: 'blue' },
                            { label: 'Month Revenue', value: '$847K', icon: 'dollar-sign', color: 'green' },
                          ].map((stat, i) => (
                            <div key={i} className="bg-white rounded-lg p-3 border border-gray-200">
                              <div className="flex items-center justify-between mb-1">
                                <Icon name={stat.icon} className={`text-${stat.color}-500 text-xs`} />
                              </div>
                              <p className="text-lg font-bold text-gray-900">{stat.value}</p>
                              <p className="text-xs text-gray-500">{stat.label}</p>
                            </div>
                          ))}
                        </div>
                        {/* Content Grid */}
                        <div className="grid grid-cols-3 gap-3">
                          {/* Jobs List */}
                          <div className="col-span-2 bg-white rounded-lg border border-gray-200 p-3">
                            <h4 className="font-medium text-gray-900 text-xs mb-3">Active Jobs</h4>
                            {['Highway 42 Expansion', 'Riverside Commercial', 'Oak Hills Subdivision'].map((job, i) => (
                              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                <div>
                                  <p className="text-xs font-medium text-gray-900">{job}</p>
                                  <p className="text-xs text-gray-400">Progress: {[65, 42, 28][i]}%</p>
                                </div>
                                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div className="h-full bg-brand-500 rounded-full" style={{width: `${[65, 42, 28][i]}%`}}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Weather */}
                          <div className="bg-white rounded-lg border border-gray-200 p-3">
                            <h4 className="font-medium text-gray-900 text-xs mb-2">Weather</h4>
                            <div className="text-center">
                              <Icon name="sun" className="text-yellow-500 text-2xl mb-1" />
                              <p className="text-xl font-bold text-gray-900">47°F</p>
                              <p className="text-xs text-gray-500">Partly Cloudy</p>
                            </div>
                            <div className="grid grid-cols-3 gap-1 mt-3">
                              {['Sat', 'Sun', 'Mon'].map((d, i) => (
                                <div key={i} className="text-center">
                                  <p className="text-xs text-gray-500">{d}</p>
                                  <Icon name={['cloud', 'cloud-rain', 'sun'][i]} className="text-xs text-gray-400 my-1" />
                                  <p className="text-xs text-gray-700">{[48, 44, 50][i]}°</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Trusted By */}
          <section className="py-12 border-y border-gray-100">
            <div className="max-w-7xl mx-auto px-6">
              <p className="text-center text-sm text-gray-500 mb-8">Trusted by 500+ excavation companies across North America</p>
              <div className="flex flex-wrap items-center justify-center gap-12 opacity-50">
                {['Summit Excavating', 'Valley Grading Co.', 'Pioneer Earthworks', 'Metro Site Prep', 'Atlas Excavation'].map((company, i) => (
                  <div key={i} className="text-xl font-bold text-gray-400">{company}</div>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="py-24 px-6">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-4xl font-bold text-gray-900 mb-4">Everything You Need to Run Your Operation</h2>
                <p className="text-xl text-gray-600 max-w-2xl mx-auto">From job scheduling to equipment tracking, Groundwork Pro has all the tools you need in one place.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {features.map((feature, i) => (
                  <div key={i} className="p-6 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-lg transition-all group">
                    <div className="w-14 h-14 bg-brand-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-100 transition-colors">
                      <Icon name={feature.icon} className="text-2xl text-brand-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                    <p className="text-gray-600 text-sm">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Photo Gallery Section */}
          <section className="py-16 px-6 bg-gray-100">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Built for the Field</h2>
                <p className="text-lg text-gray-600">From excavators to dozers, track every piece of equipment in your fleet.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { alt: 'Volvo excavator on mound', placeholder: 'GALLERY 1' },
                  { alt: 'Aerial trenching', placeholder: 'GALLERY 2' },
                  { alt: 'CAT dozer', placeholder: 'GALLERY 3' },
                  { alt: 'Operator in cab', placeholder: 'GALLERY 4' },
                  { alt: 'Wheel loader', placeholder: 'GALLERY 5' },
                  { alt: 'Excavator working', placeholder: 'GALLERY 6' },
                  { alt: 'Dozer on pile', placeholder: 'GALLERY 7' },
                  { alt: 'Dozer in woods', placeholder: 'GALLERY 8' },
                ].map((img, i) => (
                  <div key={i} className={`overflow-hidden rounded-xl ${i === 0 || i === 5 ? 'md:col-span-2 md:row-span-2' : ''}`}>
                    {IMAGES.gallery[i] && !IMAGES.gallery[i].includes('YOUR_') ? (
                      <img
                        src={IMAGES.gallery[i]}
                        alt={img.alt}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                        style={{ minHeight: i === 0 || i === 5 ? '400px' : '190px' }}
                      />
                    ) : (
                      <div
                        className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center"
                        style={{ minHeight: i === 0 || i === 5 ? '400px' : '190px' }}
                      >
                        <div className="text-center text-gray-500">
                          <Icon name="image" className="text-3xl mb-1" />
                          <p className="text-xs font-medium">{img.placeholder}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Stats */}
          <section className="py-20 bg-dark-900">
            <div className="max-w-7xl mx-auto px-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                {[
                  { value: '500+', label: 'Companies' },
                  { value: '50K+', label: 'Jobs Managed' },
                  { value: '98%', label: 'Customer Satisfaction' },
                  { value: '4.9/5', label: 'App Store Rating' },
                ].map((stat, i) => (
                  <div key={i}>
                    <p className="text-4xl md:text-5xl font-bold text-brand-500 mb-2">{stat.value}</p>
                    <p className="text-gray-400">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Testimonials */}
          <section id="testimonials" className="py-24 px-6 bg-gray-50">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-4xl font-bold text-gray-900 mb-4">Loved by Contractors</h2>
                <p className="text-xl text-gray-600">See what excavation professionals are saying about Groundwork Pro.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {testimonials.map((t, i) => (
                  <div key={i} className="p-8 bg-white rounded-xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-1 mb-4">
                      {[1,2,3,4,5].map(s => (
                        <Icon key={s} name="star" className="text-yellow-400" />
                      ))}
                    </div>
                    <p className="text-gray-700 mb-6 leading-relaxed">"{t.quote}"</p>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold">
                        {t.avatar}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{t.name}</p>
                        <p className="text-sm text-gray-500">{t.role}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Pricing */}
          <section id="pricing" className="py-24 px-6">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-16">
                <h2 className="text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h2>
                <p className="text-xl text-gray-600">Start free, upgrade as you grow. No hidden fees.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {plans.map((plan, i) => (
                  <div key={i} className={`p-8 rounded-2xl ${plan.popular ? 'bg-dark-900 text-white ring-4 ring-brand-500 scale-105' : 'bg-white border border-gray-200'}`}>
                    {plan.popular && (
                      <span className="inline-block px-3 py-1 bg-brand-500 text-white text-xs font-medium rounded-full mb-4">Most Popular</span>
                    )}
                    <h3 className={`text-2xl font-bold mb-2 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>{plan.name}</h3>
                    <p className={`text-sm mb-4 ${plan.popular ? 'text-gray-400' : 'text-gray-500'}`}>{plan.desc}</p>
                    <div className="mb-6">
                      <span className={`text-4xl font-bold ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                        {typeof plan.price === 'number' ? `$${plan.price}` : plan.price}
                      </span>
                      <span className={plan.popular ? 'text-gray-400' : 'text-gray-500'}>{plan.period}</span>
                    </div>
                    <ul className="space-y-3 mb-8">
                      {plan.features.map((f, j) => (
                        <li key={j} className={`flex items-center gap-2 text-sm ${plan.popular ? 'text-gray-300' : 'text-gray-600'}`}>
                          <Icon name="check" className={plan.popular ? 'text-brand-400' : 'text-brand-500'} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => { window.location.href = '/signup'; }}
                      className={`w-full py-3 font-semibold rounded-lg transition-colors ${
                        plan.popular
                          ? 'bg-brand-500 text-white hover:bg-brand-600'
                          : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                      }`}
                    >
                      {plan.cta}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-24 px-6 relative overflow-hidden">
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
              {IMAGES.ctaBg && !IMAGES.ctaBg.includes('YOUR_') ? (
                <img src={IMAGES.ctaBg} alt="Construction site" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-brand-700"></div>
              )}
              <div className="absolute inset-0 bg-brand-600/90"></div>
            </div>
            <div className="max-w-4xl mx-auto text-center relative z-10">
              <h2 className="text-4xl font-bold text-white mb-6">Ready to Transform Your Operation?</h2>
              <p className="text-xl text-brand-100 mb-10">Join 500+ excavation companies already using Groundwork Pro to streamline their business.</p>
              <button
                onClick={() => { window.location.href = '/signup'; }}
                className="px-10 py-4 bg-white text-brand-600 font-bold rounded-xl hover:bg-gray-100 transition-colors shadow-lg"
              >
                Start Your Free Trial
              </button>
            </div>
          </section>

          {/* Footer */}
          <footer className="py-16 px-6 bg-dark-900 text-gray-400">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
                <div className="col-span-2">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
                      <Icon name="mountain" className="text-white text-lg" />
                    </div>
                    <div>
                      <span className="font-dozer text-2xl text-white tracking-wide">GROUNDWORK</span>
                      <span className="text-brand-500 font-dozer text-2xl tracking-wide">PRO</span>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">The all-in-one platform for excavation and grading contractors. Manage your entire operation from one place.</p>
                </div>
                <div>
                  <h4 className="font-semibold text-white mb-4">Product</h4>
                  <ul className="space-y-2 text-sm">
                    <li><a href="#" className="hover:text-white">Features</a></li>
                    <li><a href="#" className="hover:text-white">Pricing</a></li>
                    <li><a href="#" className="hover:text-white">Integrations</a></li>
                    <li><a href="#" className="hover:text-white">Mobile App</a></li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-white mb-4">Company</h4>
                  <ul className="space-y-2 text-sm">
                    <li><a href="#" className="hover:text-white">About</a></li>
                    <li><a href="#" className="hover:text-white">Blog</a></li>
                    <li><a href="#" className="hover:text-white">Careers</a></li>
                    <li><a href="#" className="hover:text-white">Contact</a></li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-white mb-4">Support</h4>
                  <ul className="space-y-2 text-sm">
                    <li><a href="#" className="hover:text-white">Help Center</a></li>
                    <li><a href="#" className="hover:text-white">Documentation</a></li>
                    <li><a href="#" className="hover:text-white">API Reference</a></li>
                    <li><a href="#" className="hover:text-white">Status</a></li>
                  </ul>
                </div>
              </div>
              <div className="pt-8 border-t border-dark-700 flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="text-sm">&copy; 2026 Groundwork Pro. All rights reserved.</p>
                <div className="flex items-center gap-6">
                  <a href="#" className="hover:text-white">Privacy Policy</a>
                  <a href="#" className="hover:text-white">Terms of Service</a>
                </div>
              </div>
            </div>
          </footer>

          {/* Auth Modal */}
          {showAuthModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                <div className="p-8">
                  <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
                        <Icon name="mountain" className="text-white text-lg" />
                      </div>
                      <span className="font-dozer text-2xl text-gray-900 tracking-wide">GROUNDWORK<span className="text-brand-500">PRO</span></span>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {authMode === 'login' ? 'Welcome back' : 'Start your free trial'}
                    </h2>
                    <p className="text-gray-500 mt-1">
                      {authMode === 'login' ? 'Sign in to your account' : '14 days free. No credit card required.'}
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {authMode === 'signup' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                            placeholder="John Doe"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                          <input
                            type="text"
                            value={formData.company}
                            onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                            placeholder="Acme Excavating"
                            required
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        placeholder="you@company.com"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        placeholder={authMode === 'login' ? '••••••••' : 'Create a password'}
                        required
                      />
                    </div>
                    {authMode === 'login' && (
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-gray-600">
                          <input type="checkbox" className="rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                          Remember me
                        </label>
                        <a href="#" className="text-sm text-brand-600 hover:text-brand-700 font-medium">Forgot password?</a>
                      </div>
                    )}
                    {authError && (
                      <p className="text-sm text-red-600" role="alert">{authError}</p>
                    )}
                    {!authError && authNotice && (
                      <p className="text-sm text-green-700" role="status">{authNotice}</p>
                    )}
                    <button
                      type="submit"
                      disabled={authLoading}
                      className="w-full py-3 bg-brand-500 text-white font-semibold rounded-lg hover:bg-brand-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {authLoading ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
                    </button>
                  </form>

                  <div className="mt-6">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200"></div>
                      </div>
                      <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-white text-gray-500">or continue with</span>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <button className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <Icon name="google" className="fab text-lg" />
                        <span className="text-sm font-medium text-gray-700">Google</span>
                      </button>
                      <button className="flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                        <Icon name="microsoft" className="fab text-lg" />
                        <span className="text-sm font-medium text-gray-700">Microsoft</span>
                      </button>
                    </div>
                  </div>

                  <p className="mt-6 text-center text-sm text-gray-500">
                    {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
                    <button
                      onClick={() => {
                        setAuthError('');
                        setAuthNotice('');
                        setAuthMode(authMode === 'login' ? 'signup' : 'login');
                      }}
                      className="text-brand-600 hover:text-brand-700 font-medium"
                    >
                      {authMode === 'login' ? 'Sign up' : 'Sign in'}
                    </button>
                  </p>
                </div>

                <button
                  onClick={() => setShowAuthModal(false)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600"
                >
                  <Icon name="xmark" className="text-xl" />
                </button>
              </div>
            </div>
          )}
        </div>
      );
    };

    // ============================================
    // ROOT - Authentication Wrapper
    // ============================================
    const Root = () => {
      const [isAuthenticated, setIsAuthenticated] = useState(false);
      const [currentUser, setCurrentUser] = useState(null);

      const handleLogin = (data) => {
        setCurrentUser({ name: data.name || 'John Doe', email: data.email, company: data.company || 'Demo Company' });
        setIsAuthenticated(true);
      };

      const handleSignup = (data) => {
        setCurrentUser({ name: data.name, email: data.email, company: data.company });
        setIsAuthenticated(true);
      };

      const handleLogout = async () => {
        await supabaseBrowser().auth.signOut();
        setIsAuthenticated(false);
        setCurrentUser(null);
      };

      useEffect(() => {
        let isMounted = true;
        const supabase = supabaseBrowser();

        supabase.auth.getSession().then(({ data }) => {
          if (!isMounted) return;
          setIsAuthenticated(!!data.session);
          if (data.session?.user) {
            const email = data.session.user.email || '';
            setCurrentUser({
              name: email || 'John Doe',
              email,
              company: 'Demo Company',
            });
          }
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (!isMounted) return;
          setIsAuthenticated(!!session);
          if (!session?.user) {
            setCurrentUser(null);
            return;
          }
          const email = session.user.email || '';
          setCurrentUser({
            name: email || 'John Doe',
            email,
            company: 'Demo Company',
          });
        });

        return () => {
          isMounted = false;
          authListener.subscription.unsubscribe();
        };
      }, []);

      if (!isAuthenticated) {
        return <LandingPage onLogin={handleLogin} onSignup={handleSignup} />;
      }

      return <App currentUser={currentUser} onLogout={handleLogout} />;
    };


export default function Page() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <Root />;
}
