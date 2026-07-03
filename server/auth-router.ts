import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { router, publicProcedure, JWT_SECRET } from "./_core/trpc-base.js";
import { getDb } from "./db.js";
import { users } from "../drizzle/schema.js";
import { logger } from './logger.js';

// Input validation schemas
const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

function buildAuthResponse(user: {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}) {
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return {
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  };
}

async function loginWithFallback(input: { email: string; password: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1);

  if (!user) {
    throw new Error("Invalid email or password");
  }

  if (!user.isActive) {
    throw new Error("Account is inactive");
  }

  const isPasswordValid = await bcrypt.compare(input.password, user.password);
  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  return buildAuthResponse({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  });
}

async function getProfileWithFallback(payload: { userId: number; email: string; role: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user || !user.isActive) {
    throw new Error("User not found or inactive");
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

const authProfileSchema = z.object({
  userId: z.number(),
  email: z.string().email(),
  role: z.string(),
});

const authPayloadSchema = authProfileSchema;

export const authRouter = router({
  // Register new user
  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existingUser.length > 0) {
        throw new Error("User with this email already exists");
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(input.password, 10);

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email: input.email,
          password: hashedPassword,
          firstName: input.firstName,
          lastName: input.lastName,
          role: "farmer",
          isActive: true,
        })
        .returning();

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: newUser.id,
          email: newUser.email,
          role: newUser.role,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return {
        success: true,
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
        },
      };
    }),

  // Login existing user
  login: publicProcedure
    .input(loginSchema)
    .mutation(async ({ input }) => {
      return loginWithFallback(input);
    }),

  // Get current user profile
  me: publicProcedure.query(async ({ ctx }) => {
    // Extract token from context (set by middleware)
    const token = ctx.token;
    logger.info("[Auth.me] Token received:", token ? "YES (length: " + token.length + ")" : "NO");
    if (!token) {
      logger.info("[Auth.me] No token, returning null");
      return null;
    }

    try {
      const decoded = authPayloadSchema.parse(jwt.verify(token, JWT_SECRET));
      logger.info("[Auth.me] Token decoded successfully, userId:", decoded.userId);

      const user = await getProfileWithFallback(decoded);
      logger.info("[Auth.me] User found:", user ? "YES (id: " + user.id + ", email: " + user.email + ")" : "NO");
      if (!user) {
        logger.info("[Auth.me] User not found or inactive");
        return null;
      }

      logger.info("[Auth.me] Returning user data", { firstName: user.firstName, lastName: user.lastName });
      return user;
    } catch (error) {
      logger.error("[Auth.me] Error:", error);
      return null;
    }
  }),
});
