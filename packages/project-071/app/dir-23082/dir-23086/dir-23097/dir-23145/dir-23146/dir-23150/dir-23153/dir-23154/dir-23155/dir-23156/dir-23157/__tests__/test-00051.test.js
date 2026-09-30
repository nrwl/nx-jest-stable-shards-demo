const leaf = require('./test-00051.leaf');

test('test-00051', () => {
  const expected = 'test-00051';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
