import { nanoid as uuid } from 'nanoid';
import _noop from 'lodash/noop';

import { requestHtml, genFileBlocks } from 'src/service/utils';

import { addFetched, addFetching, fetchSourceDone } from 'src/share/actions';
import { saveToFile } from 'src/share/file';
import Sources from 'src/share/constants/sources';
import SourceProto from './source-proto';

const OpggUrl = 'https://www.op.gg';

export const getSpellName = (imgSrc = '') => {
  const matched = imgSrc.match(/(.*)\/Summoner(.*)\.png/) || [''];
  return matched.pop();
};

export const stripNumber = (src) => +src.match(/(\d+)\.png/)[1];

export default class OpGG extends SourceProto {
  constructor(version = ``, lolDir = ``, itemMap = {}, dispatch = _noop) {
    super();
    this.version = version;
    this.lolDir = lolDir;
    this.itemMap = itemMap;
    this.dispatch = dispatch;
  }

  getStat = async () => {
    const $ = await requestHtml(`${OpggUrl}/champion/statistics`, this.setCancelHook(`stats`));

    const items = $('.champion-index__champion-list').find('.champion-index__champion-item');
    const result = items.toArray().map((itm) => {
      const champ = $(itm);
      const { championKey, championName } = champ.data();
      const positions = champ
        .find('.champion-index__champion-item__position')
        .toArray()
        .map((i) => $(i).text().toLowerCase());

      return {
        key: championKey,
        name: championName,
        positions: positions.slice(),
      };
    });

    return result;
  };

  getPerksFromHtml = (alias, position, $) => {
    const perks = $('[class*=ChampionKeystoneRune] tr')
      .toArray()
      .reduce((arr, i) => {
        const styleIds = $(i)
          .find(`.perk-page__item--active img`)
          .toArray()
          .map((i) => {
            const src = $(i).attr(`src`);
            return stripNumber(src);
          });
        const fragmentIds = $(i)
          .find(`.fragment__detail img.active`)
          .toArray()
          .map((i) => {
            const src = $(i).attr(`src`);
            return stripNumber(src);
          });
        const [primaryStyleId, subStyleId] = $(i)
          .find(`.perk-page__item--mark img`)
          .toArray()
          .map((i) => {
            const src = $(i).attr(`src`);
            return stripNumber(src);
          });
        const pickCount = +$(i).find(`.pick-ratio__text`).next().next().text().replace(`,`, '');
        const winRate = $(i).find(`.win-ratio__text`).next().text().replace(`%`, '');

        const data = {
          alias: alias,
          pickCount: pickCount,
          winRate: winRate,
          position: position,
          source: Sources.Opgg,
          primaryStyleId: primaryStyleId,
          subStyleId: subStyleId,
          selectedPerkIds: styleIds.concat(fragmentIds),
          name: `${alias}-${position}, pick ${pickCount} win ${winRate}% [${Sources.Opgg}]`,
        };
        return arr.concat(data);
      }, []);

    return perks;
  };

  getChampionPerks = async (alias) => {
    try {
      const $id = uuid();
      const $ = await requestHtml(
        `${OpggUrl}/champion/${alias}/statistics`,
        this.setCancelHook($id),
        false,
      );

      const positions = $(`.champion-stats-header__position a`)
        .toArray()
        .map((i) => {
          const href = $(i).attr(`href`);
          return href.split(`/`).pop();
        });
      const firstPositionPerks = this.getPerksFromHtml(alias, positions[0], $);
      const tasks = positions.slice(1).map(async (p) => {
        const $ = await requestHtml(
          `${OpggUrl}/champion/${alias}/statistics/${p}`,
          this.setCancelHook(`${$id}-${p}`),
        );
        return this.getPerksFromHtml(alias, p, $);
      });
      const [allLeftPerks = []] = await Promise.all(tasks);

      return firstPositionPerks.concat(allLeftPerks);
    } catch (err) {
      throw new Error(err);
    }
  };

  genBlocks = async (champion, position, id) => {
    const { itemMap } = this;
    try {
      const $ = await requestHtml(
        `${OpggUrl}/champion/${champion}/statistics/${position}/item`,
        this.setCancelHook(id),
      );
      const itemTable = $('.l-champion-statistics-content__side .champion-stats__table')[0];
      const rawItems = $(itemTable)
        .find('tbody tr')
        .toArray()
        .map((tr) => {
          const [itemTd, pRateTd, wRateTd] = $(tr).find('td').toArray();
          const itemId = $(itemTd)
            .find('img')
            .attr('src')
            .match(/(.*)\/(.*)\.png/)
            .pop();
          const pickRate = $(pRateTd).find('em').text().replace(',', '');
          const winRate = $(wRateTd).text().replace('%', '');

          return {
            id: itemId,
            count: 1,
            pickRate,
            winRate,
          };
        });

      const blocks = genFileBlocks(rawItems, itemMap, position);
      return blocks;
    } catch (error) {
      throw new Error(error);
    }
  };

  genSkills = async (champion, position, id) => {
    try {
      const $ = await requestHtml(
        `${OpggUrl}/champion/${champion}/statistics/${position}/skill`,
        this.setCancelHook(id),
      );

      const skills = $('.champion-stats__filter__item .champion-stats__list')
        .toArray()
        .map((i) =>
          $(i)
            .find('.champion-stats__list__item')
            .toArray()
            .map((j) => $(j).text().trim()),
        );

      return skills;
    } catch (error) {
      throw new Error(error);
    }
  };

  genPerk = async (champion, position, id) => {
    const $ = await requestHtml(
      `${OpggUrl}/champion/${champion}/statistics/${position}`,
      this.setCancelHook(id),
    );
    return $(`.champion-overview__table--rune [class*="ChampionKeystoneRune-"]`)
      .toArray()
      .map((i) => {
        const rows = $(i).find(`tr`);
        return rows.toArray().map((r) => {
          const name = $(r)
            .find(`.champion-overview__stats--pick`)
            .text()
            .trim()
            .replace(/\s+/g, ` `);
          const mIds = $(r)
            .find(`.perk-page__item--mark img.tip`)
            .toArray()
            .map((g) => stripNumber($(g).attr(`src`)));
          const nIds = $(r)
            .find(`.perk-page__item--active img.tip`)
            .toArray()
            .map((g) => stripNumber($(g).attr(`src`)));
          const fIds = $(r)
            .find(`.fragment img.tip.active`)
            .toArray()
            .map((g) => stripNumber($(g).attr(`src`)));
          const selectedPerkIds = nIds.concat(fIds);
          const [primaryStyleId, subStyleId] = mIds.sort((a, b) => a - b);

          return {
            name: `${champion}-${position}-${name}`,
            primaryStyleId,
            subStyleId,
            selectedPerkIds,
          };
        });
      });
  };

  genChampionData = async (championName, position, id) => {
    const { version } = this;

    if (!championName || !position) {
      return Promise.reject('Please specify champion & position.');
    }

    try {
      const [blocks, skills, perks] = await Promise.all([
        this.genBlocks(championName, position, `${id}-block`),
        this.genSkills(championName, position, `${id}-skill`),
        this.genPerk(championName, position, `${id}-perk`),
      ]);

      return {
        sortrank: 1,
        priority: false,
        map: 'any',
        mode: 'any',
        type: 'custom',
        key: championName,
        champion: championName,
        position,
        title: `[OP.GG] ${position} - ${version}`,
        fileName: `[OP.GG]${championName}-${position}-${version}`,
        skills,
        blocks,
        perks,
      };
    } catch (error) {
      throw new Error(error);
    }
  };

  import = async () => {
    const { dispatch, lolDir } = this;
    try {
      const res = await this.getStat();

      const tasks = res.reduce((t, item) => {
        const { positions, key: champion } = item;
        const positionTasks = positions.map((position) => {
          const identity = uuid();

          dispatch(
            addFetching({
              champion,
              position,
              $identity: identity,
              source: Sources.Opgg,
            }),
          );

          return this.genChampionData(champion, position, identity).then((data) => {
            dispatch(
              addFetched({
                ...data,
                $identity: identity,
              }),
            );

            return data;
          });
        });

        return t.concat(positionTasks);
      }, []);

      const fetched = await Promise.all(tasks);
      const t = fetched.map((i) => saveToFile(lolDir, i));

      const result = await Promise.all(t);
      dispatch(fetchSourceDone(Sources.Opgg));

      return result;
    } catch (error) {
      throw new Error(error);
    }
  };
}
