package docread

import (
	"fmt"
	"path/filepath"
	"strings"
)

// AllowPath ensures path is either in allowedAttachments or under mediaRoot.
func AllowPath(path string, allowedAttachments []string, mediaRoot string) error {
	clean, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return fmt.Errorf("无效路径")
	}
	for _, a := range allowedAttachments {
		abs, err := filepath.Abs(filepath.Clean(a))
		if err != nil {
			continue
		}
		if abs == clean {
			return nil
		}
	}
	if mediaRoot != "" {
		root, err := filepath.Abs(filepath.Clean(mediaRoot))
		if err == nil {
			sep := string(filepath.Separator)
			if clean == root || strings.HasPrefix(clean, root+sep) {
				return nil
			}
		}
	}
	return fmt.Errorf("无权读取该路径（仅允许本轮微信附件或 wechat-media 目录）")
}
