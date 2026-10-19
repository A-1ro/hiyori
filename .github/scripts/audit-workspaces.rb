require 'fileutils'
require 'json'
require 'open3'
require 'tmpdir'
require 'yaml'

module WorkspaceAudit
  LEVELS = %w[info low moderate high critical].freeze
  REGISTRY = 'https://registry.npmjs.org'.freeze

  def self.projections(lockfile)
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

  def self.classify(raw, status, workspace, summary)
    report = JSON.parse(raw)
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
      puts "::error title=Dependency vulnerabilities detected::Review advisories for workspace #{label}."
      return 1
    end
    return incomplete('The audit command failed without a vulnerability finding.') unless status.success?

    0
  rescue JSON::ParserError, TypeError, NoMethodError
    incomplete('No valid audit report. Check the registry/network and audit command.')
  end

  def self.run(root, registry: REGISTRY)
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
        outcome = classify(raw, status, workspace, ENV['GITHUB_STEP_SUMMARY'])
        failed = true unless outcome.zero?
      end
    end
    failed ? 1 : 0
  rescue StandardError => error
    incomplete("Lockfile projection or audit execution failed (#{error.class}).")
  end
end

if $PROGRAM_NAME == __FILE__
  # The alternate registry is only for loopback regression tests; CI uses npm.
  exit WorkspaceAudit.run(ARGV.fetch(0, Dir.pwd), registry: ENV.fetch('AUDIT_REGISTRY', WorkspaceAudit::REGISTRY))
end
