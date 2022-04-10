/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs-extra';
import importFresh from 'import-fresh';
import type {SidebarsConfig, Sidebars, SidebarProcessorParams} from './types';
import {validateSidebars, validateCategoryMetadataFile} from './validation';
import {normalizeSidebars} from './normalization';
import {processSidebars} from './processor';
import {postProcessSidebars} from './postProcessor';
import path from 'path';
import {Globby} from '@docusaurus/utils';
import logger from '@docusaurus/logger';
import type {PluginOptions} from '@docusaurus/plugin-content-docs';
import Yaml from 'js-yaml';
import _ from 'lodash';
import combinePromises from 'combine-promises';

export const DefaultSidebars: SidebarsConfig = {
  defaultSidebar: [
    {
      type: 'autogenerated',
      dirName: '.',
    },
  ],
};

export const DisabledSidebars: SidebarsConfig = {};

// If a path is provided, make it absolute
export function resolveSidebarPathOption(
  siteDir: string,
  sidebarPathOption: PluginOptions['sidebarPath'],
): PluginOptions['sidebarPath'] {
  return sidebarPathOption
    ? path.resolve(siteDir, sidebarPathOption)
    : sidebarPathOption;
}

async function readCategoriesMetadata(contentPath: string) {
  const categoryFiles = await Globby('**/_category_.{json,yml,yaml}', {
    cwd: contentPath,
  });
  const categoryToFile = _.groupBy(categoryFiles, path.dirname);
  return combinePromises(
    _.mapValues(categoryToFile, async (files, folder) => {
      const filePath = files[0]!;
      if (files.length > 1) {
        logger.warn`There are more than one category metadata files for path=${folder}: ${files.join(
          ', ',
        )}. The behavior is undetermined.`;
      }
      const content = await fs.readFile(
        path.join(contentPath, filePath),
        'utf-8',
      );
      try {
        return validateCategoryMetadataFile(Yaml.load(content));
      } catch (err) {
        logger.error`The docs sidebar category metadata file path=${filePath} looks invalid!`;
        throw err;
      }
    }),
  );
}

export async function loadSidebarsFileUnsafe(
  sidebarFilePath: string | false | undefined,
): Promise<SidebarsConfig> {
  // false => no sidebars
  if (sidebarFilePath === false) {
    return DisabledSidebars;
  }

  // undefined => defaults to autogenerated sidebars
  if (typeof sidebarFilePath === 'undefined') {
    return DefaultSidebars;
  }

  // Non-existent sidebars file: no sidebars
  // Note: this edge case can happen on versioned docs, not current version
  // We avoid creating empty versioned sidebars file with the CLI
  if (!(await fs.pathExists(sidebarFilePath))) {
    return DisabledSidebars;
  }

  // We don't want sidebars to be cached because of hot reloading.
  return importFresh(sidebarFilePath);
}

export async function loadSidebars(
  sidebarFilePath: string | false | undefined,
  options: SidebarProcessorParams,
): Promise<Sidebars> {
  try {
    const sidebarsConfig = await loadSidebarsFileUnsafe(sidebarFilePath);
    const normalizedSidebars = normalizeSidebars(sidebarsConfig);
    validateSidebars(normalizedSidebars);
    const categoriesMetadata = await readCategoriesMetadata(
      options.version.contentPath,
    );
    const processedSidebars = await processSidebars(
      normalizedSidebars,
      categoriesMetadata,
      options,
    );
    return postProcessSidebars(processedSidebars, options);
  } catch (err) {
    logger.error`Sidebars file at path=${
      sidebarFilePath as string
    } failed to be loaded.`;
    throw err;
  }
}
