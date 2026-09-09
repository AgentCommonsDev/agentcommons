// Git hooks export GIT_DIR and friends to their children (a push from a linked worktree
// exports an absolute path), so a test that runs git in a temp directory would operate
// on the real repository instead. Scrub them before any test file loads.
delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;
delete process.env.GIT_INDEX_FILE;
delete process.env.GIT_COMMON_DIR;
delete process.env.GIT_OBJECT_DIRECTORY;
delete process.env.GIT_PREFIX;
delete process.env.GIT_NAMESPACE;
