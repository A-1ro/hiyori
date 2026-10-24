require 'fileutils'
require 'json'
require 'open3'
require 'tmpdir'
require 'yaml'

module WorkspaceAudit
  LEVELS = %w[info low moderate high critical].freeze
  REGISTRY = 'https://registry.npmjs.org'.freeze

  def self.validate_keys(value)
    case value
    when Hash
      # Psych uses YAML 1.1. Reject ambiguous keys (e.g. an unquoted `on`)
      # instead of silently changing a YAML 1.2 dependency name.
      raise ArgumentError, 'Non-string YAML key' unless value.keys.all? { |key| key.is_a?(String) }
      value.each_value { |child| validate_keys(child) }
    when Array
      value.each { |child| validate_keys(child) }
    end
  end

  def self.projections(lockfile)
    validate_keys(lockfile)
    unless lockfile.is_a?(Hash) && lockfile['lockfileVersion'] == '9.0' &&
           lockfile['importers'].is_a?(Hash) && !lockfile['importers'].empty? &&
           lockfile['packages'].is_a?(Hash) && lockfile['snapshots'].is_a?(Hash)
      raise ArgumentError, 'Unsupported or incomplete pnpm lockfile'
    end

    lockfile['importers'].map do |id, importer|
      raise ArgumentError, 'Invalid importer' unless importer.is_a?(Hash)

      # Preserve every dependency edge, resolution and snapshot. Only relocate
      # this importer to the root: pnpm must not audit its directory as a package.
      [id, lockfile.merge('importers' => { '.' => importer })]
    end
  end

  def self.incomplete(message)
    puts "::error title=Dependency audit could not complete::#{message}"
    1
  end

  def self.classify(raw, status, workspace, summary, records = nil)
    record = { workspace: workspace, state: 'incomplete' }
    records&.push(record)
    unless status.success? || status.exitstatus == 1
      return incomplete('The audit command did not complete normally.')
    end
    report = JSON.parse(raw)
    record[:report] = report
    counts = report.dig('metadata', 'vulnerabilities')
    unless report['error'].nil? && counts.is_a?(Hash) &&
           LEVELS.all? { |level| counts[level].is_a?(Integer) && counts[level] >= 0 }
      return incomplete('The audit returned an error or an unsupported report format.')
    end

    label = JSON.generate(workspace)
    result = LEVELS.map { |level| "#{level}: #{counts[level]}" }.join(', ')
    puts "Workspace #{label}: #{result}"
    File.open(summary, 'a') { |file| file.puts("Workspace #{label}: #{result}\n") } if summary
    puts JSON.pretty_generate(report['advisories'] || report['vulnerabilities'] || {})
    if LEVELS.drop(1).any? { |level| counts[level] > 0 }
      record[:state] = 'findings'
      puts "::error title=Dependency vulnerabilities detected::Review advisories for workspace #{label}."
      return 1
    end
    return incomplete('The audit command failed without a vulnerability finding.') unless status.success?

    record[:state] = 'clean'
    0
  rescue JSON::ParserError, TypeError, NoMethodError
    incomplete('No valid audit report. Check the registry/network and audit command.')
  end

  def self.run(root, registry: REGISTRY, report_path: ENV['AUDIT_REPORT_PATH'])
    records = []
    lockfile = YAML.safe_load(File.read(File.join(root, 'pnpm-lock.yaml')),
                              permitted_classes: [], permitted_symbols: [], aliases: false)
    projected = projections(lockfile)
    failed = false
    Dir.mktmpdir('hiyori-audit-', ENV.fetch('RUNNER_TEMP', Dir.tmpdir)) do |temporary|
      projected.each_with_index do |(workspace, projection), index|
        directory = File.join(temporary, "workspace-#{index}")
        FileUtils.mkdir_p(directory)
        # No local package identity/version is sent as a registry dependency.
        File.write(File.join(directory, 'package.json'), JSON.generate(
          'private' => true, 'packageManager' => 'pnpm@10.33.2'
        ))
        File.write(File.join(directory, 'pnpm-lock.yaml'), YAML.dump(projection))
        raw, _stderr, status = Open3.capture3(
          { 'npm_config_ignore_scripts' => 'true' },
          'pnpm', '--dir', directory, 'audit', '--audit-level=low', '--json',
          "--registry=#{registry}"
        )
        outcome = classify(raw, status, workspace, ENV['GITHUB_STEP_SUMMARY'], records)
        failed = true unless outcome.zero?
      end
    end
    failed ? 1 : 0
  rescue StandardError => error
    incomplete("Lockfile projection or audit execution failed (#{error.class}).")
  ensure
    if report_path
      File.write(report_path, JSON.pretty_generate(
        schema_version: 1,
        complete: !projected.nil? && records.size == projected.size &&
          records.all? { |record| record[:state] != 'incomplete' },
        workspaces: records
      ))
    end
  end
end

if $PROGRAM_NAME == __FILE__
  # The alternate registry is only for loopback regression tests; CI uses npm.
  exit WorkspaceAudit.run(ARGV.fetch(0, Dir.pwd), registry: ENV.fetch('AUDIT_REGISTRY', WorkspaceAudit::REGISTRY))
end
