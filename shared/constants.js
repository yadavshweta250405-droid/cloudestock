// Shared by backend and frontend (served at /shared/constants.js). Single source of truth for enums & permissions.
export const ROLES = { ADMIN: 'admin', WAREHOUSE_MANAGER: 'warehouse_manager', INVENTORY_MANAGER: 'inventory_manager', EMPLOYEE: 'employee' };
export const ROLE_LABELS = { admin: 'Administrator', warehouse_manager: 'Warehouse Manager', inventory_manager: 'Inventory Manager', employee: 'Employee' };

export const ORDER_STATUSES = ['Pending', 'Processing', 'Packed', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Cancelled'];
export const ORDER_TRANSITIONS = {
  'Pending': ['Processing', 'Cancelled'],
  'Processing': ['Packed', 'Cancelled'],
  'Packed': ['Ready for Dispatch', 'Cancelled'],
  'Ready for Dispatch': ['Dispatched', 'Cancelled'],   // Dispatched is executed through the delivery it is assigned to
  'Dispatched': ['Delivered'],
  'Delivered': [],
  'Cancelled': [],
};
export const DELIVERY_STATUSES = ['Loading', 'In Transit', 'Delivered', 'Cancelled'];
export const VEHICLE_STATUSES = ['available', 'loading', 'on_route', 'returning', 'maintenance'];
export const VEHICLE_TYPES = ['truck', 'van'];
export const DRIVER_STATUSES = ['available', 'on_duty', 'off_duty'];
export const EMPLOYEE_STATUSES = ['available', 'busy', 'on_break', 'off_duty'];
export const DEPARTMENTS = ['Receiving', 'Picking', 'Shipping', 'Inventory', 'Maintenance', 'Management'];
export const TASK_TYPES = ['receiving', 'putaway', 'picking', 'packing', 'loading', 'inventory_check', 'maintenance', 'other'];
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];
export const TASK_TARGETS = ['none', 'rack', 'dock', 'section', 'office'];
export const TASK_DEPARTMENT = { receiving: 'Receiving', putaway: 'Receiving', picking: 'Picking', packing: 'Picking', loading: 'Shipping', inventory_check: 'Inventory', maintenance: 'Maintenance', other: null };
export const SHIPMENT_STATUSES = ['Scheduled', 'Arrived', 'Unloading', 'Received', 'Cancelled'];
export const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST', 'TRANSFER_IN', 'TRANSFER_OUT'];
export const DOCK_STATUSES = ['free', 'occupied', 'maintenance'];
export const DOCK_DIRECTIONS = ['inbound', 'outbound', 'both'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const ZONES = ['indoor', 'outdoor'];

export const PURCHASE_ORDER_STATUSES = ['pending', 'approved', 'ordered', 'partially_received', 'completed', 'cancelled'];
export const RETURN_STATUSES = ['requested', 'received', 'inspected', 'approved', 'rejected', 'restocked'];
export const RETURN_REASONS = ['damaged', 'wrong_item', 'defective', 'expired', 'customer_cancelled', 'other'];
export const RETURN_CONDITIONS = ['unopened', 'opened_good', 'damaged', 'defective'];
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'];

const ALL = Object.values(ROLES);
const MGMT = ['admin', 'warehouse_manager'];
const STOCK = ['admin', 'warehouse_manager', 'inventory_manager'];
export const PERMISSIONS = {
  'dashboard:read': ALL, 'scene:read': ALL, 'search:read': ALL,
  'products:read': ALL, 'products:write': STOCK,
  'inventory:read': ALL, 'inventory:write': STOCK,
  'orders:read': ALL, 'orders:write': STOCK,
  'purchase_orders:read': ALL, 'purchase_orders:write': STOCK,
  'returns:read': ALL, 'returns:write': STOCK,
  'deliveries:read': ALL, 'deliveries:write': MGMT,
  'receiving:read': ALL, 'receiving:write': STOCK,
  'employees:read': ALL, 'employees:write': MGMT,
  'tasks:read': ALL, 'tasks:write': MGMT, 'tasks:update_own': ALL,
  'warehouse:read': ALL, 'warehouse:write': MGMT,
  'activity:read': STOCK,
  'users:manage': ['admin'],
  'sync:run': MGMT,
};
export const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role);
