import os
import requests
import json
import sys

import azure.functions as func

endpoint = "https://languagedep.cognitiveservices.azure.com/"
subscription_key = "9be55ef15c3d401e8a2efa6140bde1e0"

def get_language_code(arg1):
    apiUrl = f'{endpoint}/text/analytics/v3.2-preview.1/languages'

    requestBody = {
        'documents': [
        {
            'id': '1',
            'text': arg1
        }
        ]
    }

    requestOptions = {
        'headers': {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': subscription_key
        },
        'data': json.dumps(requestBody)
    }

    response = requests.post(apiUrl, **requestOptions)
    data = response.json()
    language_code = data['documents'][0]['detectedLanguage']['iso6391Name']

    if response.status_code == 200:
        return language_code
    else:
        raise Exception(f"Request failed with status code {response.status_code}")

def main(arg1: str) -> str:
    try:
        language_code = get_language_code(arg1)

        language_to_voice = {
            "de": "de-DE",
            "en": "en-US",
            "es": "es-ES",
            "fr": "fr-FR",
            "it": "it-IT",
            "ja": "ja-JP",
            "ko": "ko-KR",
            "pt": "pt-BR",
            "zh_chs": "zh-CN",
            "zh_cht": "zh-CN",
            "ar": "ar-AE"
        }

        return language_to_voice[language_code]
    except Exception as e:
        print(e)
        return ""
    
if __name__=='__main__':
  main(sys.argv[1])
