package store

// A Permission is one thing a person may do in a workspace. Code asks "may this person do X?" through Can and
// never compares roles, so that finer roles (per tool, custom) can be added by changing the table below and
// nothing else.
type Permission string

const (
	// PermRead: see anything in the workspace the person's role lets them see.
	PermRead Permission = "workspace:read"
	// PermWrite: add, edit, review, reply, and the other everyday changes.
	PermWrite Permission = "workspace:write"
	// PermManage: settings, billing, connections, keys, publishing, team, deletion and export.
	PermManage Permission = "workspace:manage"
)

// rolePermissions is the only place that says what a role means. Tool-specific permissions (for example
// "support:reply") get added here, granted to the roles that should have them, and checked with Can.
var rolePermissions = map[Role]map[Permission]bool{
	RoleAdmin:  {PermRead: true, PermWrite: true, PermManage: true},
	RoleMember: {PermRead: true, PermWrite: true},
	RoleViewer: {PermRead: true},
}

// Can reports whether the person may do p. An unknown role may do nothing.
func (t Tenant) Can(p Permission) bool { return rolePermissions[t.Role][p] }

// Permissions lists what the person may do, for sending to a client that wants to hide what would be refused.
// The server still refuses; this only shapes what is shown.
func (t Tenant) Permissions() []Permission {
	var out []Permission
	for _, p := range []Permission{PermRead, PermWrite, PermManage} {
		if t.Can(p) {
			out = append(out, p)
		}
	}
	return out
}
