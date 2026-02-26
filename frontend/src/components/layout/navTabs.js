// Tabs comunes que ven todos los usuarios
export const TABS_BASE = [
  { label: 'Nuevo Pedido', path: '/pedidos/nuevo' },
  { label: 'Mis Pedidos', path: '/pedidos/historial' },
]

// Tabs adicionales solo para admin
export const TABS_ADMIN = [
  { label: 'Todos los Pedidos', path: '/admin/pedidos' },
  { label: 'Art. ERP', path: '/admin/articulos' },
  { label: 'Art. Manual', path: '/admin/articulos-manuales' },
  { label: 'Config', path: '/admin/configuracion' },
]

// Función que devuelve los tabs según el rol
export const getTabsParaRol = (esAdmin) => {
  if (esAdmin) return [...TABS_BASE, ...TABS_ADMIN]
  return TABS_BASE
}
