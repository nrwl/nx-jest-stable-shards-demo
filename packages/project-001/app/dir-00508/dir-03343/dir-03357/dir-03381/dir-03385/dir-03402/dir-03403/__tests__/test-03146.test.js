const leaf = require('./test-03146.leaf');

test('test-03146', () => {
  const expected = 'test-03146';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
