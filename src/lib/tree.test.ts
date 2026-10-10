import { describe, expect, it } from 'vitest';
import {
  SETTINGS_FOLDER_TITLE,
  collectLinks,
  containsNode,
  countLinks,
  defaultHome,
  findByPath,
  listFolders,
  pathTo,
  resolveHome,
  searchLinks,
  toUrl,
  visibleChildren,
  type BNode,
} from './tree';

let seq = 0;
const link = (title: string, url: string): BNode => ({ id: String(++seq), title, url }) as BNode;
const folder = (title: string, children: BNode[]): BNode => {
  const node = { id: String(++seq), title, children } as BNode;
  children.forEach((c, i) => Object.assign(c, { parentId: node.id, index: i }));
  return node;
};

function sampleTree() {
  seq = 0;
  const dev = folder('Dev', [link('MDN Web Docs', 'https://developer.mozilla.org/'), folder('Tools', [link('Regex101', 'https://regex101.com/')])]);
  const news = folder('News', [link('BBC News', 'https://www.bbc.co.uk/news'), link('Hacker News', 'https://news.ycombinator.com/')]);
  const bar = folder('Bookmarks', [link('GitHub', 'https://github.com/'), dev, news]);
  const settings = folder(SETTINGS_FOLDER_TITLE, [link('settings', 'data:application/json,%7B%7D')]);
  const trash = folder('Trash', [link('Deleted', 'https://deleted.example/')]);
  const other = folder('Other bookmarks', [settings, trash, link('Example', 'https://example.com/')]);
  const root = folder('', [bar, other]);
  return { root, bar, dev, news, other };
}

describe('visibility', () => {
  it('hides the settings folder and the Vivaldi trash', () => {
    const { other } = sampleTree();
    expect(visibleChildren(other, 1).map((c) => c.title)).toEqual(['Example']);
  });

  it('only treats "Trash" as special near the top of the tree', () => {
    const { root } = sampleTree();
    const deep = folder('Deep', [folder('Trash', [])]);
    expect(visibleChildren(deep, 3)).toHaveLength(1);
    expect(collectLinks(root).map((l) => l.node.title)).not.toContain('Deleted');
  });

  it("goes by Vivaldi's trash flag where there is one, not the title", () => {
    const flag = (n: BNode, trash: boolean) => Object.assign(n, { trash });
    const deleted = flag(folder('Deleted', [link('Gone', 'https://gone.example/')]), true);
    const mine = flag(folder('Trash', [link('Bin day', 'https://bins.example/')]), false);
    const root = folder('', [folder('Bookmarks', [mine]), deleted]);
    expect(visibleChildren(root, 0).map((c) => c.title)).toEqual(['Bookmarks']);
    expect(collectLinks(root).map((l) => l.node.title)).toEqual(['Bin day']);
  });
});

describe('paths', () => {
  it('round-trips a folder through pathTo and findByPath', () => {
    const { root, dev } = sampleTree();
    const tools = dev.children![1];
    const path = pathTo(root, tools.id)!;
    expect(path).toEqual(['Bookmarks', 'Dev', 'Tools']);
    expect(findByPath(root, path)).toBe(tools);
  });

  it('defaults home to the first non-empty top-level folder', () => {
    const { root, bar } = sampleTree();
    expect(defaultHome(root)).toBe(bar);
  });

  it('falls back to the default home when the saved path no longer exists', () => {
    const { root, bar, news } = sampleTree();
    expect(resolveHome(root, ['Bookmarks', 'News'])).toEqual({ node: news, missing: false });
    expect(resolveHome(root, ['Bookmarks', 'Renamed'])).toEqual({ node: bar, missing: true });
    expect(resolveHome(root, null)).toEqual({ node: bar, missing: false });
  });

  it('lists folders depth-first with depth and path, excluding hidden ones', () => {
    const { root } = sampleTree();
    expect(listFolders(root).map((f) => `${f.depth}:${f.path.join('/')}`)).toEqual([
      '1:Bookmarks',
      '2:Bookmarks/Dev',
      '3:Bookmarks/Dev/Tools',
      '2:Bookmarks/News',
      '1:Other bookmarks',
    ]);
  });
});

describe('counting and containment', () => {
  it('counts links recursively', () => {
    const { dev, bar } = sampleTree();
    expect(countLinks(dev)).toBe(2);
    expect(countLinks(bar)).toBe(5);
  });

  it('detects a node inside a folder', () => {
    const { dev, news } = sampleTree();
    const tools = dev.children![1];
    expect(containsNode(dev, tools.id)).toBe(true);
    expect(containsNode(dev, dev.id)).toBe(true);
    expect(containsNode(news, tools.id)).toBe(false);
  });
});

describe('searchLinks', () => {
  const links = () => collectLinks(sampleTree().root);

  it('matches title prefixes first', () => {
    expect(searchLinks(links(), 'hack')[0].node.title).toBe('Hacker News');
  });

  it('requires every term to match somewhere', () => {
    expect(searchLinks(links(), 'news bbc').map((l) => l.node.title)).toEqual(['BBC News']);
    expect(searchLinks(links(), 'news github')).toEqual([]);
  });

  it('matches folder names and hosts', () => {
    expect(searchLinks(links(), 'tools').map((l) => l.node.title)).toEqual(['Regex101']);
    expect(searchLinks(links(), 'mozilla').map((l) => l.node.title)).toEqual(['MDN Web Docs']);
  });

  it('reports the folder path for each hit', () => {
    expect(searchLinks(links(), 'regex')[0].path).toEqual(['Bookmarks', 'Dev', 'Tools']);
  });

  it('returns nothing for a blank query and respects the limit', () => {
    expect(searchLinks(links(), '   ')).toEqual([]);
    expect(searchLinks(links(), 'e', 2)).toHaveLength(2);
  });
});

describe('toUrl', () => {
  it.each([
    ['github.com', 'https://github.com'],
    ['bbc.co.uk/news', 'https://bbc.co.uk/news'],
    ['https://example.com/x', 'https://example.com/x'],
    ['localhost:5173', 'http://localhost:5173'],
    ['vivaldi://settings', 'vivaldi://settings'],
  ])('%s → %s', (input, expected) => {
    expect(toUrl(input)).toBe(expected);
  });

  it.each(['hello world', 'svelte', 'v1.2', ''])('treats %j as a search', (input) => {
    expect(toUrl(input)).toBeNull();
  });
});
