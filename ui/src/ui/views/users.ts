import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import { icons } from "../icons.ts";

export type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export type UsersProps = {
  loading: boolean;
  users: User[];
  total: number;
  error: string | null;
  page: number;
  pageSize: number;
  isAdmin: boolean;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onCreateUser: (user: { email: string; password: string; name: string; role: string }) => void;
  onUpdateUser: (userId: string, updates: { name?: string; status?: string; role?: string }) => void;
  onResetPassword: (userId: string, newPassword: string) => void;
  onDeleteUser: (userId: string) => void;
};

export function renderUsers(props: UsersProps) {
  if (!props.isAdmin) {
    return html`
      <div class="view-empty">
        <div class="view-empty-icon">${icons.lock}</div>
        <div class="view-empty-title">Access Denied</div>
        <div class="view-empty-text">You must be an administrator to access this page.</div>
      </div>
    `;
  }

  if (props.loading && props.users.length === 0) {
    return html`
      <div class="view-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">Loading users...</div>
      </div>
    `;
  }

  if (props.error) {
    return html`
      <div class="view-error">
        <div class="view-error-icon">${icons.error}</div>
        <div class="view-error-title">Error Loading Users</div>
        <div class="view-error-text">${props.error}</div>
        <button class="btn btn-primary" @click=${props.onRefresh}>Retry</button>
      </div>
    `;
  }

  const totalPages = Math.ceil(props.total / props.pageSize);

  return html`
    <div class="users-view">
      <div class="users-header">
        <div class="users-title">
          <h2>User Management</h2>
          <span class="users-count">${props.total} users</span>
        </div>
        <button class="btn btn-primary" @click=${() => props.onCreateUser({
          email: "",
          password: "",
          name: "",
          role: "user"
        })}>
          ${icons.add}
          <span>Add User</span>
        </button>
      </div>

      <div class="users-table-container">
        <table class="users-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${props.users.filter(u => u.status === "active").length === 0
              ? html`
                  <tr>
                    <td colspan="6" class="empty-row">
                      No users found. Click "Add User" to create one.
                    </td>
                  </tr>
                `
              : props.users.filter(u => u.status === "active").map(
                  (user) => html`
                    <tr>
                      <td>
                        <div class="user-info">
                          <div class="user-avatar">${user.email[0].toUpperCase()}</div>
                          <div class="user-details">
                            <div class="user-name">${user.name || "—"}</div>
                            <div class="user-email">${user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span class="badge badge-${user.role === "admin" ? "admin" : "user"}">
                          ${user.role}
                        </span>
                      </td>
                      <td>
                        <span class="badge badge-${user.status === "active" ? "success" : "danger"}">
                          ${user.status}
                        </span>
                      </td>
                      <td>${formatRelativeTimestamp(new Date(user.createdAt))}</td>
                      <td>
                        ${user.lastLoginAt ? formatRelativeTimestamp(new Date(user.lastLoginAt)) : "Never"}
                      </td>
                      <td>
                        <div class="user-actions">
                          <button class="btn btn-sm btn-secondary" title="Edit"
                            @click=${() => props.onUpdateUser(user.id, { name: user.name ?? undefined })}>
                            ${icons.edit}
                          </button>
                          <button class="btn btn-sm btn-secondary" title="Reset Password"
                            @click=${() => props.onResetPassword(user.id, "")}>
                            ${icons.key}
                          </button>
                          <button class="btn btn-sm btn-danger" title="Delete"
                            ?disabled=${user.status === "inactive"}
                            @click=${() => props.onDeleteUser(user.id)}>
                            ${icons.trash}
                          </button>
                        </div>
                      </td>
                    </tr>
                  `
                )}
          </tbody>
        </table>
      </div>

      ${totalPages > 1
        ? html`
            <div class="users-pagination">
              <button class="btn btn-sm" ?disabled=${props.page === 1}
                @click=${() => props.onPageChange(props.page - 1)}>
                Previous
              </button>
              <span class="pagination-info">
                Page ${props.page} of ${totalPages}
              </span>
              <button class="btn btn-sm" ?disabled=${props.page >= totalPages}
                @click=${() => props.onPageChange(props.page + 1)}>
                Next
              </button>
            </div>
          `
        : nothing}
    </div>
  `;
}

export function renderUserFormModal(
  user: Partial<User> | null,
  onSave: (user: { email: string; password: string; name: string; role: string }) => void,
  onClose: () => void
) {
  let email = "";
  let password = "";
  let name = "";
  let role = "user";

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    onSave({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      name: formData.get("name") as string,
      role: formData.get("role") as string,
    });
  };

  return html`
    <div class="modal-overlay" @click=${onClose}>
      <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>${user ? "Edit User" : "Create User"}</h3>
          <button class="modal-close" @click=${onClose}>×</button>
        </div>
        <form @submit=${handleSubmit}>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value=${email} required />
          </div>
          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" value=${name} />
          </div>
          <div class="form-group">
            <label for="password">${user ? "New Password (optional)" : "Password"}</label>
            <input type="password" id="password" name="password" ?required=${!user} minlength="8" />
          </div>
          <div class="form-group">
            <label for="role">Role</label>
            <select id="role" name="role">
              <option value="user" ?selected=${role === "user"}>User</option>
              <option value="admin" ?selected=${role === "admin"}>Admin</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click=${onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary">${user ? "Save" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderResetPasswordModal(
  userId: string,
  onSave: (newPassword: string) => void,
  onClose: () => void
) {
  let newPassword = "";

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    onSave(formData.get("newPassword") as string);
  };

  return html`
    <div class="modal-overlay" @click=${onClose}>
      <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Reset Password</h3>
          <button class="modal-close" @click=${onClose}>×</button>
        </div>
        <form @submit=${handleSubmit}>
          <div class="form-group">
            <label for="newPassword">New Password</label>
            <input type="password" id="newPassword" name="newPassword" required minlength="8" />
            <small>Minimum 8 characters</small>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click=${onClose}>Cancel</button>
            <button type="submit" class="btn btn-primary">Reset Password</button>
          </div>
        </form>
      </div>
    </div>
  `;
}