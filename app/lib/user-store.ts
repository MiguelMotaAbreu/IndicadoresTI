import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { hashPassword, verifyPassword } from "./passwords.ts";

export type UserRole = "administrador" | "analista";

export type UserAccount = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
};

export type CreateUserInput = {
  email: string;
  displayName: string;
  role: UserRole;
  temporaryPassword: string;
};

type StoredUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  must_change_password: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export type UserStoreErrorCode =
  | "email_invalido"
  | "nome_invalido"
  | "perfil_invalido"
  | "email_duplicado"
  | "bootstrap_indisponivel"
  | "usuario_indisponivel"
  | "senha_reutilizada";

export class UserStoreError extends Error {
  readonly code: UserStoreErrorCode;

  constructor(code: UserStoreErrorCode, message: string) {
    super(message);
    this.name = "UserStoreError";
    this.code = code;
  }
}

const USER_COLUMNS = `
  id, email, display_name, role, password_hash, must_change_password,
  is_active, created_at, updated_at, deactivated_at
`;

// Mantém aproximadamente o mesmo custo de scrypt quando o email não existe,
// reduzindo a diferença de tempo que poderia revelar contas cadastradas.
const DUMMY_PASSWORD_HASH =
  "scrypt-v1$N=16384,r=8,p=1$rmX9xlPqKuEs39dE8-DszQ$c7h8rgedfB_ZAV953XkxRiIWGv8zp1FGzHqO7tVeIPqNF5h4W9GmeMXsAxoh1EWUDht6ZbxddR0isH5v453gxw";

function normalizeEmail(email: string): string {
  const normalized = typeof email === "string" ? email.trim().toLocaleLowerCase("pt-BR") : "";
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new UserStoreError("email_invalido", "Informe um endereço de email válido.");
  }
  return normalized;
}

function normalizeDisplayName(displayName: string): string {
  const normalized = typeof displayName === "string" ? displayName.trim().replace(/\s+/g, " ") : "";
  if (normalized.length < 2 || normalized.length > 100) {
    throw new UserStoreError("nome_invalido", "O nome deve ter entre 2 e 100 caracteres.");
  }
  return normalized;
}

function validateRole(role: string): asserts role is UserRole {
  if (role !== "administrador" && role !== "analista") {
    throw new UserStoreError("perfil_invalido", "O perfil deve ser administrador ou analista.");
  }
}

function mapAccount(row: StoredUserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deactivatedAt: row.deactivated_at,
  };
}

function isDuplicateEmailError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email");
}

export class UserStore {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  count(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS total FROM users").get() as { total: number };
    return row.total;
  }

  findByEmail(email: string): UserAccount | null {
    const normalizedEmail = normalizeEmail(email);
    const row = this.database.prepare(`
      SELECT ${USER_COLUMNS}
      FROM users
      WHERE email = ? COLLATE NOCASE
    `).get(normalizedEmail) as StoredUserRow | undefined;

    return row ? mapAccount(row) : null;
  }

  findById(userId: string): UserAccount | null {
    const row = this.database.prepare(`
      SELECT ${USER_COLUMNS}
      FROM users
      WHERE id = ?
    `).get(userId) as StoredUserRow | undefined;

    return row ? mapAccount(row) : null;
  }

  async authenticate(email: string, password: string): Promise<UserAccount | null> {
    let row: StoredUserRow | undefined;

    try {
      const normalizedEmail = normalizeEmail(email);
      row = this.database.prepare(`
        SELECT ${USER_COLUMNS}
        FROM users
        WHERE email = ? COLLATE NOCASE
      `).get(normalizedEmail) as StoredUserRow | undefined;
    } catch (error) {
      if (!(error instanceof UserStoreError) || error.code !== "email_invalido") throw error;
    }

    const passwordMatches = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !passwordMatches || row.is_active !== 1) return null;

    return mapAccount(row);
  }

  async create(input: CreateUserInput): Promise<UserAccount> {
    const prepared = await this.prepareUser(input);
    return this.insert(prepared);
  }

  async changePassword(userId: string, newPassword: string): Promise<UserAccount> {
    const current = this.database.prepare(`
      SELECT ${USER_COLUMNS}
      FROM users
      WHERE id = ? AND is_active = 1
    `).get(userId) as StoredUserRow | undefined;

    if (!current) {
      throw new UserStoreError("usuario_indisponivel", "A conta não está disponível.");
    }
    if (await verifyPassword(newPassword, current.password_hash)) {
      throw new UserStoreError("senha_reutilizada", "A nova senha deve ser diferente da senha temporária.");
    }

    const passwordHash = await hashPassword(newPassword);
    const updatedAt = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE users
      SET password_hash = ?, must_change_password = 0, updated_at = ?
      WHERE id = ? AND is_active = 1
    `).run(passwordHash, updatedAt, userId);

    if (result.changes !== 1) {
      throw new UserStoreError("usuario_indisponivel", "A conta não está disponível.");
    }

    return mapAccount({
      ...current,
      password_hash: passwordHash,
      must_change_password: 0,
      updated_at: updatedAt,
    });
  }

  async createFirstAdministrator(input: Omit<CreateUserInput, "role">): Promise<UserAccount> {
    const prepared = await this.prepareUser({ ...input, role: "administrador" });
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      if (this.count() > 0) {
        throw new UserStoreError(
          "bootstrap_indisponivel",
          "O primeiro administrador só pode ser criado quando ainda não existem usuários.",
        );
      }
      const account = this.insert(prepared);
      this.database.exec("COMMIT;");
      return account;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private async prepareUser(input: CreateUserInput): Promise<StoredUserRow> {
    const email = normalizeEmail(input.email);
    const displayName = normalizeDisplayName(input.displayName);
    validateRole(input.role);
    const passwordHash = await hashPassword(input.temporaryPassword);
    const now = new Date().toISOString();

    return {
      id: randomUUID(),
      email,
      display_name: displayName,
      role: input.role,
      password_hash: passwordHash,
      must_change_password: 1,
      is_active: 1,
      created_at: now,
      updated_at: now,
      deactivated_at: null,
    };
  }

  private insert(user: StoredUserRow): UserAccount {
    try {
      this.database.prepare(`
        INSERT INTO users (
          id, email, display_name, role, password_hash, must_change_password,
          is_active, created_at, updated_at, deactivated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING ${USER_COLUMNS}
      `).get(
        user.id,
        user.email,
        user.display_name,
        user.role,
        user.password_hash,
        user.must_change_password,
        user.is_active,
        user.created_at,
        user.updated_at,
        user.deactivated_at,
      );
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new UserStoreError("email_duplicado", "Já existe uma conta com este email.");
      }
      throw error;
    }

    return mapAccount(user);
  }
}
