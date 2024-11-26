import * as core from '@actions/core'
import * as github from '@actions/github'
import { createClient } from '@supabase/supabase-js'
import {
	buildDatabaseEntry,
	filterSuccessfulUploads,
	getRepositoryDetail,
	processName,
	validateDocsPath
} from './utils'
import { loadMetadata } from './meta'
import {
	deleteLeftoverFiles,
	generateArticleMap,
	manageDocumentStorage,
	upsertDatabaseEntry
} from './docs'
import type { DatabaseEntry } from './types'

async function run() {
	try {
		const githubToken = core.getInput('github-token', { required: true })
		const supabaseUrl = core.getInput('supabase-url', { required: true })
		const supabaseKey = core.getInput('supabase-key', { required: true })
		const docsPath = core.getInput('docs-path', { required: true })
		const metaPath = core.getInput('meta-path', { required: true })
		const dbTable = core.getInput('db-table', { required: true })
		const storageBucket = core.getInput('storage-bucket', { required: true })

		validateDocsPath(docsPath)

		const supabase = createClient(supabaseUrl, supabaseKey)
		const octokit = github.getOctokit(githubToken)

		const repoDetails = await getRepositoryDetail(octokit, github.context)
		const metadata = loadMetadata(metaPath)
		const { title: name, slug } = processName(
			metadata.name ?? repoDetails.name,
			false
		)

		const articles = generateArticleMap(docsPath)
		const successfulUploadPaths = await manageDocumentStorage(
			supabase,
			storageBucket,
			slug,
			articles
		)

		const uploadedArticles = filterSuccessfulUploads(
			articles,
			successfulUploadPaths
		)

		const { data: existingDatabaseEntry }: { data: DatabaseEntry | null } =
			await supabase.from(dbTable).select('*').eq('slug', slug).single()

		await deleteLeftoverFiles(
			supabase,
			storageBucket,
			slug,
			uploadedArticles,
			existingDatabaseEntry?.articles
		)

		const newDatabaseEntry = buildDatabaseEntry(
			name,
			slug,
			articles,
			metadata,
			repoDetails,
			existingDatabaseEntry
		)

		await upsertDatabaseEntry(supabase, dbTable, newDatabaseEntry)

		core.info('Upload completed successfully')
	} catch (error) {
		if (error instanceof Error) {
			core.debug(error.stack || 'No stack trace')
			core.setFailed(error.message)
		} else {
			core.setFailed('Unknown error')
		}
	}
}

run()
