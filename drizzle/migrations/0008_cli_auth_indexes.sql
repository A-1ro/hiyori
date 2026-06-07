CREATE INDEX IF NOT EXISTS `cli_auth_requests_userCode_idx` ON `cli_auth_requests` (`userCode`);
CREATE INDEX IF NOT EXISTS `cli_auth_requests_deviceCodeHash_idx` ON `cli_auth_requests` (`deviceCodeHash`);
