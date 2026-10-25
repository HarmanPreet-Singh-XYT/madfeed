package store

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestWhatEachRoleMayDo(t *testing.T) {
	cases := []struct {
		role                Role
		read, write, manage bool
	}{
		{RoleAdmin, true, true, true},
		{RoleMember, true, true, false},
		{RoleViewer, true, false, false},
		{Role("someone-new"), false, false, false}, // an unknown role may do nothing
		{Role(""), false, false, false},
	}
	for _, c := range cases {
		tn := Tenant{Role: c.role}
		if tn.Can(PermRead) != c.read || tn.Can(PermWrite) != c.write || tn.Can(PermManage) != c.manage {
			t.Errorf("role %q: read/write/manage = %v/%v/%v, want %v/%v/%v", c.role,
				tn.Can(PermRead), tn.Can(PermWrite), tn.Can(PermManage), c.read, c.write, c.manage)
		}
		if tn.CanWrite() != c.write {
			t.Errorf("role %q: CanWrite = %v, want %v", c.role, tn.CanWrite(), c.write)
		}
	}
}

func TestNoPermissionIsGrantedToALowerRoleThatAHigherOneLacks(t *testing.T) {
	order := []Role{RoleViewer, RoleMember, RoleAdmin}
	for i := 1; i < len(order); i++ {
		for p, ok := range rolePermissions[order[i-1]] {
			if ok && !rolePermissions[order[i]][p] {
				t.Errorf("%s has %s but the higher role %s does not", order[i-1], p, order[i])
			}
		}
	}
}

// Code asks Can(permission); it must not compare roles itself, or finer roles could never be added in one place.
func TestCodeAsksForPermissionsNotRoles(t *testing.T) {
	compare := regexp.MustCompile(`\.Role\s*(==|!=)\s*(store\.)?(Role(Admin|Member|Viewer)|"(admin|member|viewer)")`)
	root := filepath.Join("..", "..") // api/
	var offenders []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || strings.HasSuffix(path, ".gen.go") {
			return nil
		}
		if strings.Contains(filepath.ToSlash(path), "internal/store/") {
			return nil // the permission table itself, and the Tenant that holds the role
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(b), "\n") {
			if compare.MatchString(line) {
				offenders = append(offenders, path+":"+strconv.Itoa(i+1))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(offenders) > 0 {
		t.Errorf("compare permissions with t.Can(...), not roles:\n  %s", strings.Join(offenders, "\n  "))
	}
}
