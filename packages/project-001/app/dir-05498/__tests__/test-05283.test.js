const leaf = require('./test-05283.leaf');

test('test-05283', () => {
  const expected = 'test-05283';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
