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
  { role: "admin", resource: "rewards", action: "read:any", attributes: "*" },

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
];

export const ac = new AccessControl(grantList);
