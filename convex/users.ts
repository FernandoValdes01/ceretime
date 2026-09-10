import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createTestUser = mutation({
  args: {
    email: v.string(),
    fullName: v.string(),
    role: v.union(
      v.literal("student"),
      v.literal("professional"),
      v.literal("intern"),
      v.literal("admin")
    ),
    institutionalStatus: v.union(
      v.literal("enabled"),
      v.literal("disabled"),
      v.literal("pending")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", {
      email: args.email,
      fullName: args.fullName,
      role: args.role,
      institutionalStatus: args.institutionalStatus,
      accountStatus: "active",
    });
  },
});

export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});