import { AccessControl } from "accesscontrol";

const grantList = [
  // admin — full access tất cả resources, any scope
  { role: "admin", resource: "product", action: "create:any", attributes: "*" },
  { role: "admin", resource: "product", action: "read:any", attributes: "*" },
  { role: "admin", resource: "product", action: "update:any", attributes: "*" },
  { role: "admin", resource: "product", action: "delete:any", attributes: "*" },
  { role: "admin", resource: "order", action: "create:any", attributes: "*" },
  { role: "admin", resource: "order", action: "read:any", attributes: "*" },
  { role: "admin", resource: "order", action: "update:any", attributes: "*" },
  { role: "admin", resource: "order", action: "delete:any", attributes: "*" },
  { role: "admin", resource: "user", action: "read:any", attributes: "*" },
  { role: "admin", resource: "user", action: "update:any", attributes: "*" },
  { role: "admin", resource: "user", action: "delete:any", attributes: "*" },
  { role: "admin", resource: "inventory", action: "read:any", attributes: "*" },
  {
    role: "admin",
    resource: "inventory",
    action: "update:any",
    attributes: "*",
  },
  { role: "admin", resource: "payment", action: "read:any", attributes: "*" },
  { role: "admin", resource: "shipping", action: "read:any", attributes: "*" },
  {
    role: "admin",
    resource: "shipping",
    action: "update:any",
    attributes: "*",
  },
  { role: "admin", resource: "rewards", action: "read:any", attributes: "*" },
  { role: "admin", resource: "brand", action: "read:any", attributes: "*" },
  { role: "admin", resource: "brand", action: "update:any", attributes: "*" },
  { role: "admin", resource: "category", action: "read:any", attributes: "*" },
  {
    role: "admin",
    resource: "category",
    action: "update:any",
    attributes: "*",
  },
  // voucher — VOUCHER-SHOP-01. Separate resource so a shop can issue its own
  // discount codes without widening the `order` grant it already holds.
  { role: "admin", resource: "voucher", action: "create:any", attributes: "*" },
  { role: "admin", resource: "voucher", action: "read:any", attributes: "*" },
  { role: "admin", resource: "voucher", action: "update:any", attributes: "*" },
  { role: "admin", resource: "voucher", action: "delete:any", attributes: "*" },

  // post — social post moderation (admin-only)
  { role: "admin", resource: "post", action: "read:any", attributes: "*" },
  { role: "admin", resource: "post", action: "update:any", attributes: "*" },
  { role: "admin", resource: "post", action: "delete:any", attributes: "*" },

  // shop — quản lý sản phẩm của mình, xem order
  { role: "shop", resource: "product", action: "create:own", attributes: "*" },
  { role: "shop", resource: "product", action: "read:any", attributes: "*" },
  { role: "shop", resource: "product", action: "update:own", attributes: "*" },
  { role: "shop", resource: "product", action: "delete:own", attributes: "*" },
  { role: "shop", resource: "order", action: "read:any", attributes: "*" },
  { role: "shop", resource: "order", action: "update:own", attributes: "*" },
  { role: "shop", resource: "inventory", action: "read:own", attributes: "*" },
  {
    role: "shop",
    resource: "inventory",
    action: "update:own",
    attributes: "*",
  },
  { role: "shop", resource: "voucher", action: "create:own", attributes: "*" },
  { role: "shop", resource: "voucher", action: "read:own", attributes: "*" },
  { role: "shop", resource: "voucher", action: "update:own", attributes: "*" },
  { role: "shop", resource: "user", action: "read:own", attributes: "*" },
  {
    role: "shop",
    resource: "user",
    action: "update:own",
    attributes: "*, !password",
  },

  // user — chỉ thao tác trên data của mình
  { role: "user", resource: "order", action: "create:own", attributes: "*" },
  { role: "user", resource: "order", action: "read:own", attributes: "*" },
  { role: "user", resource: "order", action: "update:own", attributes: "*" },
  { role: "user", resource: "user", action: "read:own", attributes: "*" },
  {
    role: "user",
    resource: "user",
    action: "update:own",
    attributes: "*, !password",
  },
  { role: "user", resource: "payment", action: "read:own", attributes: "*" },
  { role: "user", resource: "rewards", action: "read:own", attributes: "*" },

  // logistics_operator — read-only GHN/shipping access (web shipping ops)
  {
    role: "logistics_operator",
    resource: "shipping",
    action: "read:any",
    attributes: "*",
  },

  // shipping_manager — read + update GHN/shipping (manual sync, status ops)
  {
    role: "shipping_manager",
    resource: "shipping",
    action: "read:any",
    attributes: "*",
  },
  {
    role: "shipping_manager",
    resource: "shipping",
    action: "update:any",
    attributes: "*",
  },
];

export const ac = new AccessControl(grantList);
