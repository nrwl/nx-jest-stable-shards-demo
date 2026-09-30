const leaf = require('./test-04511.leaf');

test('test-04511', () => {
  const expected = 'test-04511';
  burn(2281);
  expect(leaf.value).toBe(expected);
});
