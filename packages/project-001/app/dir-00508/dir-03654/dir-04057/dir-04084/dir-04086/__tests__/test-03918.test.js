const leaf = require('./test-03918.leaf');

test('test-03918', () => {
  const expected = 'test-03918';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
