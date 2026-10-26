## 2. Best Chinese cases to consider

Here are the strongest candidates based on public data availability and suitability for your calculus project.

[Aerial view of Shanghai downtown Lujiazui financial district skyline](https://images.openai.com/static-rsc-4/bIBONm0cJp3VlahwjpK6vS0JhMj2_drObLTEmK8Jlrr6643LRIKTvCLe8Ftm18PLI5yYBjRoeWuEsey77lYui80gJbGr5a3iX3zCoRjCu5lYDp0ceKpfyZh9-Il6jQ7VLgiT60swLxj9c1HGANvVXRGT43ospcTjdTlQwRL0mXCfAahHR3HCnL4yE-SosduZ?purpose=inline)

## 1. Shanghai

My first choice

Model: Concentric zone model

Shanghai's official [2025 Statistical Yearbook](https://tjj.sh.gov.cn/tjnj/tjnj2025e.htm?utm_source=chatgpt.com) includes a table of land area, population, and population density by district for 2024.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://tjj.sh.gov.cn\&sz=32)

上海市统计局



Why it works: You can obtain real district-level population and area data, calculate density, and compare it with distance from a selected urban center.

Limitation: Shanghai has multiple centers and a large geographic extent, so the concentric model will not necessarily fit well.

[High angle view of city skyline](https://images.openai.com/static-rsc-4/qqUUjxdXWtncQR4C4j2LOZcBLrSXSC1OaNWTsGqMyqBdof-tlIEVE2cCdr9NcZdwQB7x7ynyp9M2AYal8HY1ak_yHj_jhpgIthVDtGo5z2qqu8VdExhD_OlQ8VfDpbPHBEBGTSkhs1J7wpzRjm0vnrdNvsXn2GAlWzH2AOKzDjrvg3BjetzQ8ym2fjzmF9Y9?purpose=inline)

## 2. Guangzhou

Model: Concentric zone model

The [official Guangzhou statistical yearbook](https://tjj.gz.gov.cn/datav/admin/home/www_nj/2024/directory/01/html/01-02.htm?utm_source=chatgpt.com) reports district land area, permanent population, and population density for 2023.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://tjj.gz.gov.cn\&sz=32)

广州市统计局



Why it works: You can directly download or transcribe the published figures and compare the densely populated central districts with more distant districts.

Limitation: The outer districts cover enormous areas, so district-level density can obscure the actual urban pattern.

[Beijing CBD area](https://images.openai.com/static-rsc-4/c5NuOYSqyReDOpaH-Rz5HLipXLuML0iqEpuEHFFsw5cLhLRBAP5__hSGgeXG8kgKYdGE9E7plhnuoZ9JpDA1Rq57G1Mt2vVh3VD48pRGPR4xGUGqCWoOg8ewDp6fIpHvSEolEemP6HG86RZUotoPjqDImDulImaubXb4ToPewEmgL7KhBpWw6Es-uwfbaFul?purpose=inline)

## 3. Beijing

Model: Concentric zone model

Beijing is interesting for investigating whether density and land use change with distance from the traditional city center.

Why it works: The city's ring roads provide a useful geographical reference for discussing how an idealized circular model compares with actual urban development.

Limitation: You will need to assemble consistent population and geographic data for the districts or smaller neighborhoods; I have not verified a single ready-made dataset for that combination here.

## 3. How I would actually execute the Shanghai project

I would use the concentric zone model, with Shanghai as the case study.

### Step 1: Assemble a small, defensible dataset

Use the 2024 district data in the official Shanghai Statistical Yearbook. For each district, collect its population density and obtain its geographic centroid from a boundary dataset.

Your dataset would look like this:

| District        | Population density | Distance from center |
| --------------- | ------------------ | -------------------- |
| Huangpu         | Official value     | Calculated           |
| Jing'an         | Official value     | Calculated           |
| Hongkou         | Official value     | Calculated           |
| Xuhui           | Official value     | Calculated           |
| Other districts | Official values    | Calculated           |

The table above is a template, not a dataset of calculated values. Obtain the actual figures from the [official yearbook](https://tjj.sh.gov.cn/tjnj/tjnj2025e.htm?utm_source=chatgpt.com).&#x20;

[image](https://www.google.com/s2/favicons?domain=https://tjj.sh.gov.cn\&sz=32)

上海市统计局



Use a consistent population definition and reference year. For the geographic calculations, use distances in kilometers and population density in people per square kilometer.

### Step 2: Fit a density model

I would try an exponential model:

\\[ D(r)=D_0e^{-kr},\qquad D_0>0,\ k>0. \\]

It represents a hypothesis that density decreases as distance from the center increases.

Taking logarithms gives

\\[ \ln D(r)=\ln D_0-kr. \\]

This is linear in \\(r\\), so you can fit it using Apache Commons Math 3's `SimpleRegression` with:

- \\(x=r\\)
- \\(y=\ln D\\)

Then recover the parameters from the regression intercept and slope. If the fitted slope is not negative, that is a result to discuss rather than something to conceal.

### Step 3: Apply parametric calculus

For a circular boundary of radius \\(R\\),

\\[ \mathbf r(t)=\langle R\cos t,R\sin t\rangle. \\]

Differentiate to obtain velocity and integrate its magnitude to calculate arc length:

\\[ L=\int_0^{2\pi}\\|\mathbf r'(t)\\|\\,dt=2\pi R. \\]

Next, estimate the population inside radius \\(R\\) by integrating density over circular rings:

\\[ P(R)=2\pi\int_0^R rD_0e^{-kr}\\,dr. \\]

Using integration by parts, which is within AP Calculus BC, you obtain

\\[ \boxed{ P(R)=\frac{2\pi D_0}{k^2} \left[1-(1+kR)e^{-kR}\right] }. \\]

This gives you a meaningful calculus result: an estimated cumulative population as a function of distance from the city center.

Remember that the integral assumes a circularly symmetric density distribution. Shanghai's actual geography and multiple urban centers violate that assumption to some degree, which gives you a strong basis for evaluating the model.

## 4. One important decision before committing

There is a trade-off between easy data collection and mathematical reliability:

- Shanghai: Strong official data sources and an interesting model to evaluate, but district-level observations are coarse.
- Guangzhou: Another accessible official district-level dataset, with the same geographic limitation.
- A gravity model using Chinese cities: Potentially easier to assemble population and distance data for many cities, but finding comparable observed interaction data to validate the model is harder.

For your stated requirements, I would start with Shanghai. You can obtain the demographic evidence from a primary source, use Java and Apache Commons Math 3, and demonstrate parametric functions, derivatives, arc length, regression, and integration without going beyond the AP Calculus BC syllabus.